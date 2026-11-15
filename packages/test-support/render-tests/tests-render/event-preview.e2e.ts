// An event's live preview under its row (DESIGN-UI.md → The routines calendar →
// an event's preview is one line): one muted line at the row's indent, whose
// choices show on hover, which floats the calendar's own box at the popover's
// width when pressed, and which wraps after the time on a phone. What the line
// says is the calendar page's component test's: here the family's engine runs,
// and the page lays it out.
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
 * preview (so the engine sends nothing), and a Gym repeating by `rrule` (daily,
 * unless a test says otherwise) under the fixture root.
 */
async function seedEvent(request: APIRequestContext, rrule = "FREQ=DAILY"): Promise<string> {
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
      [F("rrule")]: [str(rrule)],
    }),
  });
  return gym.id;
}

/** The box's width, in CSS pixels. */
const widthOf = async (box: Locator) => (await box.boundingBox())?.width ?? 0;

/** The event's line under its row, once the row's preview has mounted it. */
async function lineOf(page: Page, id: string): Promise<Locator> {
  const region = page.locator(`[data-row-preview="${id}"] [role="group"]`);
  // The view mounts once its box comes near the viewport (`useSeen`).
  await region.scrollIntoViewIfNeeded();
  const line = region.locator("[data-event-line]");
  await expect(line).toBeVisible();
  return line;
}

test("an event's preview is one line at the row's indent, its choices on hover, and pressing it floats the calendar's box", async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-14T10:00:00"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const id = await seedEvent(request);
  await page.goto(`/node/${ROOT}`);
  const line = await lineOf(page, id);
  const row = page.locator(`[data-node-block="true"][data-node-id="${id}"]`).first();
  const [lineBox, rowBox] = [await line.boundingBox(), await row.boundingBox()];
  expect(lineBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  if (lineBox === null || rowBox === null) return;
  // One line, at the row's indent rather than under the whole row.
  expect(lineBox.height).toBeLessThan(32);
  expect(lineBox.x).toBeGreaterThan(rowBox.x);
  expect((await line.textContent()) ?? "").not.toContain("Gym");

  const done = line.locator('[data-event-line-choice="done"]');
  await page.mouse.move(0, 0);
  await expect(done).toBeHidden();
  await line.hover();
  await expect(done).toBeVisible();

  // Pressed at its start, where its choices never lie.
  await line.getByText("Personal", { exact: true }).click();
  const floated = page.getByTestId("entry-popover");
  await expect(floated.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  const preview = await widthOf(floated);
  await page.keyboard.press("Escape");
  await expect(floated).toBeHidden();

  await page.goto("/calendar/week/2026-11-14");
  await page.locator(`[data-entry^="${id}/"]`).first().click();
  const popover = page.getByTestId("entry-popover");
  await expect(popover).toBeVisible();
  expect(Math.abs(preview - (await widthOf(popover)))).toBeLessThanOrEqual(1);
});

test("on a phone the line wraps after the time, and the time stays whole", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.clock.setFixedTime(new Date("2026-11-14T10:00:00"));
  // A repeat long enough that the line is wider than a phone's column.
  const id = await seedEvent(request, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR,SA");
  await page.goto(`/node/${ROOT}`);
  const line = await lineOf(page, id);
  const when = await line.locator("[data-event-line-when]").boundingBox();
  const repeat = await line.locator("[data-event-line-repeat]").boundingBox();
  const lineBox = await line.boundingBox();
  await expect(line.locator("[data-event-line-repeat]")).toContainText("Every 2 weeks");
  expect(when).not.toBeNull();
  expect(repeat).not.toBeNull();
  expect(lineBox).not.toBeNull();
  if (when === null || repeat === null || lineBox === null) return;
  // The time is one line, and what follows it starts below it.
  expect(when.height).toBeLessThan(24);
  expect(repeat.y).toBeGreaterThanOrEqual(when.y + when.height - 1);
  expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(360);
  // The row it wraps to starts where the line does, with no separator before it.
  const start = await line.locator("[data-event-line-part] > span").first().boundingBox();
  expect(Math.abs((start?.x ?? 0) - repeat.x)).toBeLessThanOrEqual(1);
});

// The choices lie over the line's end, so showing them, on hover or on focus,
// never makes the line taller or moves what is below it, however long the
// repeat and however narrow the page.
for (const [name, width, scheme] of [
  ["light", 1100, "light"],
  ["dark", 1100, "dark"],
  ["a phone", 360, "light"],
] as const) {
  test(`in ${name}, showing the line's choices keeps its height`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.clock.setFixedTime(new Date("2026-11-14T10:00:00"));
    const id = await seedEvent(request, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU");
    await page.goto(`/node/${ROOT}`);
    const line = await lineOf(page, id);
    await expect(line.locator("[data-event-line-repeat]")).toContainText(
      "Every week on Mon, Tue, Wed, Thu, Fri, Sat, Sun",
    );
    const choices = line.locator("[data-event-line-choice]");
    await expect(choices.first()).toBeHidden();
    const height = (await line.boundingBox())?.height;
    expect(height).toBeGreaterThan(0);

    await line.hover();
    await expect(choices.last()).toBeVisible();
    expect(await choices.allTextContents()).toEqual(["Done", "Skip", "Move…"]);
    expect((await line.boundingBox())?.height).toBe(height);

    await page.mouse.move(0, 0);
    await line.locator("[data-event-line-open]").focus();
    await expect(choices.last()).toBeVisible();
    expect((await line.boundingBox())?.height).toBe(height);
  });
}
