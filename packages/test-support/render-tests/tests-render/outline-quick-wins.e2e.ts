// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// What rows hold, read and copied, and Recent (DESIGN-UI.md → Outline
// editor, "What rows hold, read and copied"; Node-scoped commands, "Recent
// is screen state"), end to end in a browser: Count words says what a range
// holds, Copy node ID puts its ids on the clipboard, and the sidebar's
// Recent lists the nodes zoomed to, newest first, across a reload, with
// nothing written to the store.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";

/** Run kb action `id` over the API, and answer its output. */
async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output as T;
}

const add = async (request: APIRequestContext, text: string, parent = ROOT): Promise<string> =>
  (await invoke<{ id: string }>(request, "node.add", { text, parent })).id;

/** When the store last changed `id`. */
const updatedAt = async (request: APIRequestContext, id: string): Promise<string> =>
  (await invoke<{ node: { updatedAt: string } }>(request, "node.get", { id })).node.updatedAt;

const row = (page: Page, id: string) =>
  page.locator(`[data-node-row="true"][data-node-id="${id}"]`);

/** Select the row `first` and the `extend` rows below it. */
async function selectDown(page: Page, first: string, extend: number): Promise<void> {
  await row(page, first).scrollIntoViewIfNeeded();
  await row(page, first).locator(".node-content").click();
  await page.keyboard.press("Escape");
  await expect(row(page, first)).toHaveAttribute("data-selected", "true");
  for (let i = 0; i < extend; i += 1) await page.keyboard.press("Shift+ArrowDown");
}

/** Run the node menu's command `label` on what is selected. */
async function runFromMenu(page: Page, label: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  const menu = page.getByRole("dialog", { name: "Node commands" });
  await expect(menu.getByRole("option", { name: label })).toBeVisible();
  await page.keyboard.type(label.toLowerCase());
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("Count words says the words, characters and nodes of a range and what is under it", async ({
  page,
  request,
}) => {
  const first = await add(request, "Plant the **tomatoes**");
  const second = await add(request, "Harvest in autumn");
  // Under the range, shown or not, and counted with it.
  await add(request, "Water daily", second);
  const before = await updatedAt(request, first);
  await page.goto(`/node/${ROOT}`);

  await selectDown(page, first, 1);
  await runFromMenu(page, "Count words");
  await expect(
    page.locator('[data-kind="info"]', { hasText: "8 words · 46 characters · 3 nodes" }),
  ).toBeVisible();
  expect(await updatedAt(request, first)).toBe(before);
});

test("Copy node ID puts each selected row's id on the clipboard, one per line", async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const first = await add(request, "First to copy");
  const second = await add(request, "Second to copy");
  await page.goto(`/node/${ROOT}`);

  await selectDown(page, first, 1);
  await runFromMenu(page, "Copy node IDs");
  await expect(page.locator('[data-kind="info"]', { hasText: "2 node IDs copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${first}\n${second}`);
});

test("Recent lists the nodes zoomed to, newest first, across a reload, writing nothing", async ({
  page,
  request,
}) => {
  const garden = await add(request, "Garden journal");
  const kitchen = await add(request, "Kitchen notes");
  const before = await updatedAt(request, garden);
  const recent = page.getByRole("group", { name: "Recent" });

  await page.goto(`/outline/${garden}`);
  await expect(recent.getByRole("button", { name: "Garden journal" })).toBeVisible();
  await page.goto(`/outline/${kitchen}`);
  await expect(recent.getByRole("button")).toHaveText(["Kitchen notes", "Garden journal"]);

  await page.reload();
  await expect(recent.getByRole("button")).toHaveText(["Kitchen notes", "Garden journal"]);

  // A row zooms to its node, which leads Recent again.
  await recent.getByRole("button", { name: "Garden journal" }).click();
  await expect(page).toHaveURL(new RegExp(`/outline/${garden}$`));
  await expect(recent.getByRole("button")).toHaveText(["Garden journal", "Kitchen notes"]);
  expect(await updatedAt(request, garden)).toBe(before);
});
