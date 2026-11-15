// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A selection is a range of rows (DESIGN-UI.md → Outline editor), end to
// end in a browser: Shift+↓ draws each row of the range selected, the node
// menu over it offers only the commands that act on each row, a tag picked
// goes on every row as one write the server stores, one undo takes it back,
// and Delete removes the whole range, one undo bringing it back.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";

/** Run kb action `id` over the API, and answer its output. */
async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  if (receipt.output === undefined) throw new Error(`${id} answered nothing`);
  return receipt.output;
}

const add = async (request: APIRequestContext, text: string): Promise<string> =>
  (await invoke<{ id: string }>(request, "node.add", { text, parent: ROOT })).id;

/** The tags the store holds on `id`, by id. */
async function tagsOf(request: APIRequestContext, id: string): Promise<unknown[]> {
  const { node } = await invoke<{ node: { props: Record<string, { v: unknown }[]> } }>(
    request,
    "node.get",
    { id, depth: 0 },
  );
  return (node.props["sys.f.type"] ?? []).map((value) => value.v);
}

/** Whether the store still holds `id`. */
async function held(request: APIRequestContext, id: string): Promise<boolean> {
  const response = await request.post("/api/action", {
    data: { id: "node.get", input: { id, depth: 0 } },
  });
  return ((await response.json()) as { status: string }).status === "succeeded";
}

const row = (page: Page, id: string) =>
  page.locator(`[data-node-row="true"][data-node-id="${id}"]`);

test("a range of rows is selected by Shift+↓, tagged as one write, and deleted as one", async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tag = (await invoke<{ id: string }>(request, "tag.define", { name: "Topic" })).id;
  const rows = [
    await add(request, "First"),
    await add(request, "Second"),
    await add(request, "Third"),
  ];
  const [first = "", , third = ""] = rows;
  await page.goto(`/node/${ROOT}`);

  // Edit the first row, leave its editor for the row, and extend down twice.
  await row(page, first).locator(".node-content").click();
  await expect(row(page, first)).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Escape");
  await expect(row(page, first)).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  for (const id of rows) await expect(row(page, id)).toHaveAttribute("aria-selected", "true");
  // The focus stays on the head, the last row reached.
  await expect(row(page, third)).toBeFocused();

  // The node menu over the range: the commands that act on each row.
  await page.keyboard.press("ControlOrMeta+k");
  const menu = page.getByRole("dialog", { name: "Node commands" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option", { name: "Add tag" })).toBeVisible();
  await expect(menu.getByRole("option", { name: "Delete nodes" })).toBeVisible();
  await expect(menu.getByRole("option", { name: "Make supertag" })).toHaveCount(0);
  await page.keyboard.type("add tag");
  await page.keyboard.press("Enter");
  const step = page.getByRole("dialog", { name: "Add tag" });
  await expect(step).toBeVisible();
  await page.keyboard.type("Topic");
  await page.keyboard.press("Enter");
  await expect(step).toBeHidden();
  // Closed, the menu gives the focus back to the head, the range kept.
  await expect(row(page, third)).toBeFocused();
  for (const id of rows) await expect.poll(() => tagsOf(request, id)).toEqual([tag]);

  // One undo takes the tag off every row.
  await page.keyboard.press("ControlOrMeta+z");
  for (const id of rows) await expect.poll(() => tagsOf(request, id)).toEqual([]);

  // Delete takes the range; one undo brings it back, in its place.
  for (const id of rows) await expect(row(page, id)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Delete");
  for (const id of rows) await expect.poll(() => held(request, id)).toBe(false);
  await page.keyboard.press("ControlOrMeta+z");
  for (const id of rows) await expect.poll(() => held(request, id)).toBe(true);
  await expect(
    page.locator(`[data-node-row="true"][data-node-id]`).filter({ hasText: /First|Second|Third/ }),
  ).toHaveText(["First", "Second", "Third"]);
});
