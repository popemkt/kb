// What waits to sync when one instance of a series changes (DESIGN-UI.md →
// The routines calendar, sync status): the instance alone, not its series,
// and the calendar's line counts writes, not the instances it shows. The
// family's engine runs here (`kb ui`) but sends nothing, because no Google
// account is trusted; with no list of Google's to plan against it marks
// nothing either, so each status is written here as the engine writes it
// (docs/research/2026-11-02-kb-routines-gcal.md → Status on nodes). That the
// engine marks one changed instance waiting alone is its own scenario.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

// Routines is a family `kb ui` hosts, so these run against `kb ui` itself.
test.use({ harnessOptions: { hosted: true } });

const ROOT = "render.fixture.root";
const TYPE = "sys.f.type";
const F = (key: string) => `sys.f.routines.${key}`;
const ref = (v: string) => ({ t: "ref", v });
const str = (v: string) => ({ t: "str", v });
const num = (v: number) => ({ t: "num", v });

async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output as T;
}

type Props = Record<string, unknown[]>;
const props = (all: Props) =>
  Object.entries(all).flatMap(([field, values]) => values.map((value) => ({ field, value })));

/** Write `state` on node `id`'s sync status, as the engine writes it. */
async function writeStatus(request: APIRequestContext, id: string, state: string): Promise<void> {
  await invoke(request, "node.update", {
    id,
    unsetProps: [{ field: F("status") }],
    setProps: [{ field: F("status"), value: ref(`${F("status")}.${state}`) }],
  });
}

/** The occurrence node Done gave `routine`. */
async function occurrenceOf(request: APIRequestContext, routine: string): Promise<string> {
  const { node } = await invoke<{ node: { children?: { id: string }[] } }>(request, "node.get", {
    id: routine,
    depth: 1,
  });
  const child = node.children?.[0]?.id;
  expect(child).toBeDefined();
  return child ?? "";
}

/**
 * The routines family on, a calendar that sends (`sync: on`), and a Gym every
 * day of the week of 2026-11-16, its series sent, its status written as a
 * send writes it.
 */
async function seedSentSeries(
  request: APIRequestContext,
): Promise<{ readonly gym: string; readonly calendar: string }> {
  await invoke(request, "extension.switch", { name: "routines", on: true });
  // An account, so the toolbar reads its status; never trusted, so nothing is sent.
  const account = await invoke<{ id: string }>(request, "node.add", {
    text: "e2e@example.com",
    parent: ROOT,
    props: props({ [TYPE]: [ref("sys.tag.google-account")] }),
  });
  const calendar = await invoke<{ id: string }>(request, "node.add", {
    text: "Personal",
    parent: ROOT,
    props: props({
      [TYPE]: [ref("sys.tag.calendar")],
      [F("sync")]: [ref(`${F("sync")}.on`)],
      [F("calendarId")]: [str("e2e-calendar")],
      [F("account")]: [ref(account.id)],
    }),
  });
  const gym = await invoke<{ id: string }>(request, "node.add", {
    text: "Gym",
    parent: ROOT,
    props: props({
      [TYPE]: [ref("sys.tag.routine")],
      [F("calendar")]: [ref(calendar.id)],
      [F("starts")]: [str("2026-11-16")],
      [F("at")]: [str("07:00")],
      [F("duration")]: [num(60)],
      [F("rrule")]: [str("FREQ=DAILY")],
    }),
  });
  await writeStatus(request, gym.id, "synced");
  return { gym: gym.id, calendar: calendar.id };
}

const chip = (page: Page, key: string) => page.locator(`[data-entry="${key}"]`).first();

test("one instance marked done waits alone, and the calendar counts one write", async ({
  page,
  request,
}) => {
  const { gym, calendar } = await seedSentSeries(request);
  await page.clock.setFixedTime(new Date("2026-11-18T10:00:00"));
  await page.goto("/calendar/week/2026-11-18");
  const summary = page.locator('[data-sync-summary][role="status"]').first();
  await expect(summary).toHaveText(/Synced/);
  const week = ["16", "17", "18", "19", "20", "21", "22"].map((d) => `${gym}/2026-11-${d}`);
  for (const key of week)
    await expect(chip(page, key).locator("[data-sync-status]")).toHaveAttribute(
      "data-sync-status",
      "synced",
    );

  const marked = `${gym}/2026-11-18`;
  await chip(page, marked).click();
  await page
    .locator(`[data-event-card="${marked}"]`)
    .getByRole("button", { name: "Done", exact: true })
    .click();

  // The engine says the instance waits on its own occurrence, never its series.
  await writeStatus(request, await occurrenceOf(request, gym), "pending");
  await expect(chip(page, marked).locator("[data-sync-status]")).toHaveAttribute(
    "data-sync-status",
    "pending",
    { timeout: 15_000 },
  );
  for (const other of week.filter((day) => day !== marked))
    await expect(chip(page, other).locator("[data-sync-status]")).toHaveAttribute(
      "data-sync-status",
      "synced",
    );
  await expect(summary).toHaveText(/1 waiting/);
  // A calendar's own failure (its list call, or an ending) is one more write.
  await writeStatus(request, calendar, "error");
  await expect(summary).toHaveText(/1 failed/);
});
