// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The page's own keys, end to end (DESIGN-UI.md → Keybindings): days binds
// "Go to today" to Mod-Shift-D on `core.page`, the key context core owns
// and the page answers before any surface does. So the key opens today's
// page from a row being edited, and the row takes no letter from it. The
// harness's store has days switched off, so the spec switches it on, as a
// person would, over the API.
import type { APIRequestContext } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const ROW = "render.fixture.node.2";

/** Run kb action `id` over the API; its output. */
async function call(request: APIRequestContext, id: string, input: unknown): Promise<unknown> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: unknown };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output;
}

/** The text the store holds for `id`. */
async function storedText(request: APIRequestContext, id: string): Promise<string> {
  const { node } = (await call(request, "node.get", { id })) as { node: { text: string } };
  return node.text;
}

test("Mod-Shift-D opens today's page, even from a row being edited", async ({ page, request }) => {
  await call(request, "extension.switch", { name: "days", on: true });
  const before = await storedText(request, ROW);
  await page.goto(`/node/${ROOT}`);
  const row = page.locator(`[data-node-id="${ROW}"]`).first();
  await expect(row).toBeVisible();
  await row.locator(".node-content").first().click();
  await expect(page.locator(`[data-node-id="${ROW}"][data-active="true"]`)).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Shift+D");
  // The page's local day, YYYY-MM-DD, as the page names today.
  const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
  await expect(page.locator(`[data-day-page="${today}"]`)).toBeVisible();

  // The row took no letter from the key: its text is as it was.
  await page.goBack();
  await expect(row).toBeVisible();
  expect(await storedText(request, ROW)).toBe(before);
});
