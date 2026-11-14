// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A row moves anywhere (DESIGN-UI.md → Outline editor), end to end in a
// browser: Move to… from the node menu puts a range of rows under the node
// picked as one write the server stores, the range still selected where it
// went; one undo takes it back; Alt+Enter leaves a reference where each was.
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

interface Held {
  readonly id: string;
  readonly children?: readonly Held[];
  readonly props: Record<string, { v: unknown }[]>;
}

/** The node `id` as the store holds it, its children with it. */
const get = async (request: APIRequestContext, id: string): Promise<Held> =>
  (await invoke<{ node: Held }>(request, "node.get", { id, depth: 1 })).node;

/** The ids of the children of `id`, in order. */
const childrenOf = async (request: APIRequestContext, id: string): Promise<string[]> =>
  ((await get(request, id)).children ?? []).map((child) => child.id);

const row = (page: Page, id: string) =>
  page.locator(`[data-node-row="true"][data-node-id="${id}"]`);

/** Select the rows from `first` down to `last`, `extend` rows below it. */
async function selectDown(page: Page, first: string, extend: number): Promise<void> {
  await row(page, first).locator(".node-content").click();
  await expect(row(page, first)).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Escape");
  await expect(row(page, first)).toHaveAttribute("data-selected", "true");
  for (let i = 0; i < extend; i += 1) await page.keyboard.press("Shift+ArrowDown");
}

/** Open Move to… from the node menu, and search for `where`. */
async function moveTo(page: Page, where: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  const menu = page.getByRole("dialog", { name: "Node commands" });
  await expect(menu.getByRole("option", { name: "Move to…" })).toBeVisible();
  await page.keyboard.type("move to");
  await page.keyboard.press("Enter");
  const step = page.getByRole("dialog", { name: "Move to" });
  await expect(step).toBeVisible();
  await expect(step).toContainText("⌥↵ leave a reference");
  await page.keyboard.type(where);
  await expect(step.getByRole("option").first()).toContainText(where);
}

test("Move to… puts a range of rows under the node picked, as one write and one undo", async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const first = await add(request, "First to move");
  const second = await add(request, "Second to move");
  const shelf = await add(request, "Destination shelf");
  await page.goto(`/node/${ROOT}`);

  await selectDown(page, first, 1);
  await moveTo(page, "Destination shelf");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Move to" })).toBeHidden();
  await expect.poll(() => childrenOf(request, shelf)).toEqual([first, second]);

  // Drawn where they went, they are still the range selected.
  for (const id of [first, second]) {
    await expect(row(page, id)).toHaveAttribute("aria-selected", "true");
  }

  // One undo puts both back where they were.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => childrenOf(request, shelf)).toEqual([]);
  const top = await childrenOf(request, ROOT);
  expect(top.indexOf(second)).toBe(top.indexOf(first) + 1);
});

test("Alt+Enter in Move to… leaves a reference where the row was", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const moving = await add(request, "Row that leaves a reference");
  const after = await add(request, "Row after it");
  const shelf = await add(request, "Shelf for references");
  await page.goto(`/node/${ROOT}`);

  await selectDown(page, moving, 0);
  await moveTo(page, "Shelf for references");
  await page.keyboard.press("Alt+Enter");
  await expect.poll(() => childrenOf(request, shelf)).toEqual([moving]);

  // In its place, before the row after it, a reference to it.
  const top = await childrenOf(request, ROOT);
  const left = top[top.indexOf(after) - 1] ?? "";
  const reference = await get(request, left);
  expect(reference.props["sys.f.ref.target"]?.[0]?.v).toBe(moving);
  // The reference is what is selected, where the row was.
  await expect(row(page, left)).toHaveAttribute("aria-selected", "true");
});
