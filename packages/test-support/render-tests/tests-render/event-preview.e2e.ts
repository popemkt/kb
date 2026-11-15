// An event's live preview under its row (DESIGN-UI.md → The routines calendar →
// an event on its own): the calendar's own box, at the popover's width, and as
// tall as what it shows, so it never scrolls inside itself. How the box words
// a sync time is the calendar page's component test's: here the family's engine
// runs, and owns a routine's sync status.
import type { APIRequestContext, Locator, Page } from "playwright/test";
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

/**
 * The routines family on, its event preview shown always, a calendar in
 * preview (so the engine sends nothing), and a daily Gym under the fixture root.
 */
async function seedEvent(request: APIRequestContext): Promise<string> {
  await invoke(request, "extension.switch", { name: "routines", on: true });
  await invoke(request, "node.update", {
    id: "sys.extension.routines",
    setProps: [
      {
        field: "sys.f.display.routines.event.preview",
        value: ref("sys.f.display.routines.event.preview.always"),
      },
    ],
  });
  const calendar = await invoke<{ id: string }>(request, "node.add", {
    text: "Personal",
    parent: ROOT,
    props: props({
      [TYPE]: [ref("sys.tag.calendar")],
      [F("sync")]: [ref(`${F("sync")}.preview`)],
    }),
  });
  const gym = await invoke<{ id: string }>(request, "node.add", {
    text: "Gym",
    parent: ROOT,
    props: props({
      [TYPE]: [ref("sys.tag.routine")],
      [F("calendar")]: [ref(calendar.id)],
      [F("starts")]: [str("2026-11-01")],
      [F("at")]: [str("07:00")],
      [F("duration")]: [num(60)],
      [F("rrule")]: [str("FREQ=DAILY")],
    }),
  });
  return gym.id;
}

/** The box's width, in CSS pixels. */
const widthOf = async (box: Locator) => (await box.boundingBox())?.width ?? 0;

async function previewOf(page: Page, id: string) {
  const frame = page.locator(`[data-row-preview="${id}"] [role="group"]`);
  // The view mounts once its box comes near the viewport (`useSeen`).
  await frame.scrollIntoViewIfNeeded();
  await expect(frame).toBeVisible();
  const card = frame.locator("[data-event-card]");
  await expect(card.getByRole("button", { name: "Done" })).toBeVisible();
  return { frame, card };
}

test("an event's preview is as tall as its box, never scrolls, and every action is inside it", async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const id = await seedEvent(request);
  await page.goto(`/node/${ROOT}`);
  const { frame, card } = await previewOf(page, id);
  const sizes = await frame.evaluate((el) => ({
    scroll: el.scrollHeight,
    client: el.clientHeight,
    overflow: getComputedStyle(el).overflowY,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
  expect(["auto", "scroll"]).not.toContain(sizes.overflow);
  const edge = await frame.boundingBox();
  for (const name of ["Done", "Skip", "Move this one…", "Edit event", "Open in outline"]) {
    const button = await card.getByRole("button", { name, exact: true }).boundingBox();
    expect(button, name).not.toBeNull();
    expect(edge).not.toBeNull();
    if (button === null || edge === null) continue;
    expect(button.y, name).toBeGreaterThanOrEqual(edge.y);
    expect(button.y + button.height, name).toBeLessThanOrEqual(edge.y + edge.height + 0.5);
  }
  // Every time on it is worded, none an ISO instant.
  expect((await card.textContent()) ?? "").not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
});

test("it is the calendar popover's width, at the row's indent rather than the whole row", async ({
  page,
  request,
}) => {
  const id = await seedEvent(request);
  await page.goto(`/node/${ROOT}`);
  const { frame, card } = await previewOf(page, id);
  const row = page.locator(`[data-node-block="true"][data-node-id="${id}"]`).first();
  expect(await widthOf(frame)).toBeLessThan(await widthOf(row));
  const preview = await widthOf(card);

  await page.goto("/calendar/week");
  await page.locator(`[data-entry^="${id}/"]`).first().click();
  const popover = page.getByTestId("entry-popover");
  await expect(popover).toBeVisible();
  expect(Math.abs(preview - (await widthOf(popover)))).toBeLessThanOrEqual(1);
});
