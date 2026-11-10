// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A trusted repository extension's keys, end to end (DESIGN-UI.md →
// Keybindings): the test kit's example extension, installed and trusted in
// the scratch root, binds Alt-↑ over the outline's own chords by naming
// what it replaces, ⌘⇧Y to kb's `node.update`, and ⌘⇧J to a rating of no
// stars that its own guard refuses. Real key events reach
// the outline's dispatch, the action goes through the server's invoke path
// and its guards, and the store is read back over the API.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

test.use({ harnessOptions: { example: true } });

const ROOT = "render.fixture.root";
const leaf = (n: number) => `render.fixture.node.${n}`;

/** A node as the store holds it now, its children by id. */
async function node(
  request: APIRequestContext,
  id: string,
): Promise<{ text: string; children: string[]; props: Record<string, unknown> }> {
  const response = await request.post("/api/action", { data: { id: "node.get", input: { id } } });
  const receipt = (await response.json()) as {
    status: string;
    message?: string;
    output?: {
      node: { text: string; children: readonly { id: string }[]; props: Record<string, unknown> };
    };
  };
  expect(receipt.status, receipt.message).toBe("succeeded");
  if (receipt.output === undefined) throw new Error(`node.get ${id} answered nothing`);
  const { text, children, props } = receipt.output.node;
  return { text, children: children.map((child) => child.id), props };
}

/** The fixture root's page, once the example's page half has loaded beside it. */
async function openRoot(page: Page): Promise<void> {
  await page.goto(`/node/${ROOT}`);
  await expect(page.locator('[data-example="section"]')).toBeVisible();
  await expect(page.locator(`[data-node-id="${leaf(2)}"]`).first()).toBeVisible();
}

/** Edit the row of `id`: a press on its text. */
async function edit(page: Page, id: string): Promise<void> {
  await page.locator(`[data-node-id="${id}"] .node-content`).first().click();
  await expect(page.locator(`[data-node-id="${id}"][data-active="true"]`)).toBeVisible();
}

test("Alt-↑ moves the row while editing and while selected, and a bare arrow still moves the selection", async ({
  page,
  request,
}) => {
  await openRoot(page);
  await edit(page, leaf(3));
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(async () => (await node(request, ROOT)).children.slice(0, 3))
    .toEqual([leaf(1), leaf(3), leaf(2)]);

  // Selected, the same chord moves the row again; a bare ↑ selects the row above.
  await page.keyboard.press("Escape");
  await expect(page.locator(`[data-node-id="${leaf(3)}"][data-selected="true"]`)).toBeVisible();
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(async () => (await node(request, ROOT)).children.slice(0, 3))
    .toEqual([leaf(3), leaf(1), leaf(2)]);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`[data-node-id="${leaf(1)}"][data-selected="true"]`)).toBeVisible();
});

test("⌘⇧Y on a selected row runs node.update on it through the invoke path", async ({
  page,
  request,
}) => {
  await openRoot(page);
  await edit(page, leaf(2));
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+Shift+Y");
  await expect.poll(async () => (await node(request, leaf(2))).text).toBe("Stamped by the example");
  expect((await node(request, leaf(1))).text).not.toBe("Stamped by the example");
});

test("a key whose action a guard refuses changes nothing, and the person is told", async ({
  page,
  request,
}) => {
  // No stars is no rating: the example's stars guard refuses the write on every surface.
  await openRoot(page);
  await edit(page, leaf(2));
  await page.keyboard.press("Escape");
  await expect(page.locator(`[data-node-id="${leaf(2)}"][data-selected="true"]`)).toBeVisible();
  const before = (await node(request, leaf(2))).props;
  await page.keyboard.press("ControlOrMeta+Shift+J");
  await expect(page.getByText(/^Not saved: .*a rating is a whole number of stars/)).toBeVisible();
  expect((await node(request, leaf(2))).props).toEqual(before);
});
