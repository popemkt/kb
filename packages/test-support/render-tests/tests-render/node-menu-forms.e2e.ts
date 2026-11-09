// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A node command and a picker step written as data (DESIGN-UI.md → The node
// menu), end to end: the test kit's example extension, installed and trusted
// in the scratch root, adds "Link to a note…" to the node menu. Its `when` is
// a query node, so a note is not offered it; on a plain row it opens its
// step, whose candidates are another query node's answer; and the pick
// calls kb's own `node.update` through the page's invoke path, which adds
// the note picked to the row's `links` field.
import type { APIRequestContext, Locator, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

test.use({ harnessOptions: { example: true } });

const ROOT = "render.fixture.root";
const NOTED = "example.noted";
const LINKS = "example.f.links";
const COMMAND = "Link to a note…";

/** Run kb action `id` over the API, and answer its output. */
async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  if (receipt.output === undefined) throw new Error(`${id} answered nothing`);
  return receipt.output;
}

/** A new last child of the fixture root. */
async function add(
  request: APIRequestContext,
  input: { text: string; tags?: string[] },
): Promise<string> {
  return (await invoke<{ id: string }>(request, "node.add", { ...input, parent: ROOT })).id;
}

/** The values the store holds for `field` on `id`. */
async function valuesOf(request: APIRequestContext, id: string, field: string): Promise<unknown> {
  const { node } = await invoke<{ node: { props: Record<string, unknown> } }>(request, "node.get", {
    id,
    depth: 0,
  });
  return node.props[field] ?? [];
}

/** The node menu, opened by ⌘K on the row of `id` once a press on `target` has selected it. */
async function menuOn(page: Page, id: string, target: Locator): Promise<Locator> {
  await target.click();
  await expect(page.locator(`[data-node-id="${id}"][data-active="true"]`)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const menu = page.getByRole("dialog", { name: "Node commands" });
  await expect(menu).toBeVisible();
  return menu;
}

test("a command and a step written as data link a row to the note picked", async ({
  page,
  request,
}) => {
  const alpha = await add(request, { text: "Alpha note", tags: [NOTED] });
  await add(request, { text: "Beta note", tags: [NOTED] });
  const row = await add(request, { text: "A plain row" });
  await page.goto(`/node/${ROOT}`);

  // A note is not offered it: its `when` query answers only rows that are no note.
  const note = page.locator(`[data-node-id="${alpha}"] [data-example="note"]`);
  let menu = await menuOn(page, alpha, note);
  await expect(menu.getByRole("option", { name: "Add tag" })).toBeVisible();
  await expect(menu.getByRole("option", { name: COMMAND })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // A plain row is, among the shell's own "make" rows.
  menu = await menuOn(page, row, page.locator(`[data-node-id="${row}"] .node-content`).first());
  await expect(menu.getByRole("option", { name: COMMAND })).toBeVisible();
  await page.keyboard.type("link to a note");
  await page.keyboard.press("Enter");

  // Its step: the notes, by their text, from the step's query node.
  const step = page.getByRole("dialog", { name: "Link to a note" });
  await expect(step).toBeVisible();
  await expect(step.getByPlaceholder("Search the notes…")).toBeVisible();
  await expect(step.getByRole("option")).toHaveText(["Alpha note", "Beta note"]);
  await page.keyboard.type("alpha");
  await page.keyboard.press("Enter");
  await expect(step).toBeHidden();

  // The pick is node.update's: the note is the row's link.
  await expect.poll(() => valuesOf(request, row, LINKS)).toEqual([{ t: "ref", v: alpha }]);
});
