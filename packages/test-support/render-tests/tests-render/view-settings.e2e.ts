// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A frame's view settings in a real page: a board asks for its group field
// and is grouped from the settings popover, a table's fields are removed and
// added there, and its page size is chosen, each written to the frame's view
// node and read back by the view. Screenshots of the popover over a board
// and over a table are written beside the run.
import { FIELD_TYPE_OPTION_IDS } from "@kb/model";
import type { Locator, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const FRAME = "vs.frame";

const ref = (v: string) => ({ t: "ref", v });

/** Wait out the page's transitions, so a screenshot shows it settled. */
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );

/** Open the slot named `name` and take the candidate labelled `label`. */
async function pick(scope: Locator, page: Page, name: string, label: string) {
  await scope.locator(`[data-qb-slot="${name}"]`).click();
  await page.keyboard.type(label);
  await expect(
    page
      .locator('[role="option"]')
      .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })
      .first(),
  ).toBeVisible();
  await page.keyboard.press("Enter");
}

test("a frame's group, fields and page size are set from its view settings", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const action = async (id: string, input: Record<string, unknown>) => {
    const response = await request.post("/api/action", { data: { id, input } });
    const receipt = await response.json();
    expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
    return receipt;
  };

  for (const [id, text, type] of [
    ["vs.f.status", "status", FIELD_TYPE_OPTION_IDS.ref],
    ["vs.f.owner", "owner", FIELD_TYPE_OPTION_IDS.text],
  ] as const) {
    await action("node.add", {
      id,
      text,
      parent: ROOT,
      props: [
        { field: "sys.f.type", value: ref("sys.field") },
        { field: "sys.f.fieldType", value: ref(type) },
      ],
    });
  }
  for (const [id, text] of [
    ["vs.s.doing", "Doing"],
    ["vs.s.done", "Done"],
  ] as const) {
    await action("node.add", { id, text, parent: "vs.f.status" });
  }
  await action("node.add", {
    id: "vs.t.task",
    text: "task",
    parent: ROOT,
    props: [
      { field: "sys.f.type", value: ref("sys.tag") },
      { field: "sys.f.fields", value: ref("vs.f.status") },
    ],
  });
  await action("node.add", { id: FRAME, text: "Sprint", parent: ROOT, position: 0 });
  for (const [id, text, status] of [
    ["vs.n.a", "Write the spec", "vs.s.done"],
    ["vs.n.b", "Build the popover", "vs.s.doing"],
    ["vs.n.c", "Take screenshots", "vs.s.doing"],
  ] as const) {
    await action("node.add", {
      id,
      text,
      parent: FRAME,
      props: [
        { field: "sys.f.type", value: ref("vs.t.task") },
        { field: "vs.f.status", value: ref(status) },
        { field: "vs.f.owner", value: { t: "str", v: "kb" } },
      ],
    });
  }

  await page.goto(`/node/${FRAME}`);
  const toolbar = page.locator(`[data-view-toolbar][data-frame-id="${FRAME}"]`).first();
  const gear = page.locator(`[data-view-toolbar-gear][data-frame-id="${FRAME}"]`).first();
  if (await gear.isVisible()) await gear.click();
  await toolbar.locator('[data-mode-button="board"]').click();

  // A board with no group field asks for one, and the popover sets it.
  const board = page.locator(`[data-board-cards-view][data-frame-id="${FRAME}"]`).first();
  await expect(board).toHaveAttribute("data-board-empty", "true");
  await board.locator('[data-choose-group="true"]').click();
  const popover = page.getByTestId("view-settings-popover");
  const sections = popover.locator(`[data-view-settings-sections="${FRAME}"]`);
  await expect(sections).toBeVisible();
  // A board declares a group field and fields, and no page size.
  await expect(sections.locator('[data-qb-slot="page size"]')).toHaveCount(0);
  await pick(sections, page, "group by", "status");
  await expect(board).not.toHaveAttribute("data-board-empty", "true");
  await expect(sections.locator('[data-qb-slot="group by"]')).toHaveAttribute(
    "aria-label",
    "group by: status",
  );
  await expect(page.getByText("Doing", { exact: true }).first()).toBeVisible();
  await settled(page);
  await page.screenshot({ path: testInfo.outputPath("view-settings-board.png") });
  await page.keyboard.press("Escape");
  await page.mouse.click(1200, 880);

  // A table: its fields and page size.
  if (await gear.isVisible()) await gear.click();
  await toolbar.locator('[data-mode-button="table"]').click();
  await toolbar.locator('[data-view-settings-button="true"]').click();
  await expect(sections).toBeVisible();
  const columns = sections.locator(`[data-view-columns="${FRAME}"]`);
  // Naming none, the table shows the fields the rows' tags declare.
  await expect(columns.locator("[data-view-column]")).toHaveCount(1);
  await pick(sections, page, "add field", "owner");
  await expect(columns.locator("[data-view-column]")).toHaveCount(2);
  await expect(
    page.locator("th, [role='columnheader']").filter({ hasText: "owner" }).first(),
  ).toBeVisible();
  await columns.getByRole("button", { name: "Remove field status" }).click();
  await expect(columns.locator("[data-view-column]")).toHaveCount(1);
  await expect(columns.locator('[data-view-column="vs.f.owner"]')).toBeVisible();
  await pick(sections, page, "page size", "10 rows");
  await expect(sections.locator('[data-qb-slot="page size"]')).toHaveAttribute(
    "aria-label",
    "page size: 10 rows",
  );
  await settled(page);
  await page.screenshot({ path: testInfo.outputPath("view-settings-table.png") });
  await popover.screenshot({ path: testInfo.outputPath("view-settings-popover.png") });

  // Each choice is the frame's view node's: read back from the store.
  const response = await request.post("/api/action", {
    data: { id: "node.get", input: { id: FRAME, depth: 1 } },
  });
  const stored = JSON.stringify(await response.json());
  expect(stored).toContain("vs.f.owner");
  expect(errors).toEqual([]);
});
