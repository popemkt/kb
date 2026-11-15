// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A reference in the text opens in place (DESIGN-UI.md → Contextual
// references), end to end in a browser: Alt-click opens the target under
// its row, editable there, and again closes it, with nothing written but
// the edit; Remove reference… turns a reference back into its label.
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

const add = async (request: APIRequestContext, text: string): Promise<string> =>
  (await invoke<{ id: string }>(request, "node.add", { text, parent: ROOT })).id;

/** The text the store holds for `id`. */
const textOf = async (request: APIRequestContext, id: string): Promise<string> =>
  (await invoke<{ node: { text: string } }>(request, "node.get", { id })).node.text;

const block = (page: Page, key: string) =>
  page.locator(`[data-node-block="true"][data-instance-key="${key}"]`);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("Alt-click opens a reference under its row, editable there, and again closes it", async ({
  page,
  request,
}) => {
  const target = await add(request, "Reading list");
  const row = await add(request, `See [[${target}|Reading list]] soon`);
  await page.goto(`/node/${ROOT}`);
  const rowBlock = page.locator(`[data-node-block="true"][data-node-id="${row}"]`).first();
  await rowBlock.scrollIntoViewIfNeeded();
  const pill = rowBlock.locator(`[data-kb-ref-id="${target}"]`).first();

  await pill.click({ modifiers: ["Alt"] });
  const open = block(page, `ref:row:${row}/${target}`);
  await expect(open).toBeVisible();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  // Still on this page: the click opened in place and went nowhere.
  expect(page.url()).toContain(ROOT);

  // The open reference is the target's row: what is typed there is the target's.
  await open.locator(".node-content").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" for winter");
  await expect.poll(() => textOf(request, target)).toBe("Reading list for winter");
  await page.keyboard.press("Escape");

  await pill.click({ modifiers: ["Alt"] });
  await expect(open).toHaveCount(0);
  await expect(pill).not.toHaveAttribute("aria-expanded", "true");
  expect(await textOf(request, row)).toBe(`See [[${target}|Reading list]] soon`);
});

test("Remove reference… turns a reference back into its label", async ({ page, request }) => {
  const target = await add(request, "Garden plan");
  const row = await add(request, `Water the [[${target}|garden]] daily`);
  await page.goto(`/node/${ROOT}`);
  const rowEl = page.locator(`[data-node-row="true"][data-node-id="${row}"]`).first();
  await rowEl.scrollIntoViewIfNeeded();
  await rowEl.locator(".node-content").click();
  await page.keyboard.press("Escape");
  await expect(rowEl).toHaveAttribute("data-selected", "true");

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("remove reference");
  await page.keyboard.press("Enter");
  const step = page.getByRole("dialog", { name: "Remove reference" });
  await expect(step.getByRole("option").first()).toContainText("Garden plan");
  await page.keyboard.press("Enter");
  await expect.poll(() => textOf(request, row)).toBe("Water the garden daily");
});
