// What waits to sync when one instance of a series changes (DESIGN-UI.md →
// The routines calendar, sync status): the instance alone, not its series,
// and the calendar's line counts writes, not the instances it shows. The
// family's engine runs here (`kb ui`), and marks what waits; it sends nothing,
// because no Google account is trusted, so a write once sent is recorded as
// the engine records it.
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

/** The routine's sync status option, as its node holds it. */
async function statusOf(request: APIRequestContext, id: string): Promise<string | undefined> {
  const { node } = await invoke<{ node: { props: Record<string, { v: string }[]> } }>(
    request,
    "node.get",
    { id, depth: 0 },
  );
  return node.props[F("status")]?.[0]?.v;
}

/**
 * The routines family on, a calendar that sends (`sync: on`), and a Gym every
 * day of the week of 2026-11-16, its series sent: the engine has said it waits,
 * and its status is then written as a send writes it.
 */
async function seedSentSeries(request: APIRequestContext): Promise<string> {
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
  await expect
    .poll(() => statusOf(request, gym.id), { timeout: 15_000 })
    .toBe(`${F("status")}.pending`);
  await invoke(request, "node.update", {
    id: gym.id,
    setProps: [{ field: F("status"), value: ref(`${F("status")}.synced`) }],
  });
  return gym.id;
}

const chip = (page: Page, key: string) => page.locator(`[data-entry="${key}"]`).first();

test("one instance marked done waits alone, and the calendar counts one write", async ({
  page,
  request,
}) => {
  const gym = await seedSentSeries(request);
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

  // The engine has read the change once the instance waits; the same reading
  // would have said its series waits, had it.
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
  expect(await statusOf(request, gym)).toBe(`${F("status")}.synced`);
});
