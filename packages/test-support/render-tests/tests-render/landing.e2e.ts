// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Where the page opens, end to end (DESIGN.md → Provider roles, `ui.landing`;
// DESIGN-UI.md → Days). A load at the root with days on draws
// today first: the workspace is held in its neutral state while the landing
// is asked, so no frame paints the root on the way. A link names its own
// place and wins. The harness's store
// has days switched off, so the specs switch it on over the API, as a
// person would.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";

/** Run kb action `id` over the API; its output. */
async function call(request: APIRequestContext, id: string, input: unknown): Promise<unknown> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: unknown };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output;
}

interface Frame {
  readonly path: string;
  readonly drawn: boolean;
}

/**
 * Record, from the document's first frame, each animation frame's path and
 * whether the workspace is drawn (`.kb-workspace-reveal`, which holds every
 * page once the shell draws it), read back with `framesOf`.
 */
async function recordFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: { path: string; drawn: boolean }[] = [];
    Object.assign(window, { __kbFrames: frames });
    const tick = () => {
      frames.push({
        path: location.pathname,
        drawn: document.querySelector(".kb-workspace-reveal") !== null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function framesOf(page: Page): Promise<Frame[]> {
  return page.evaluate(
    () => (window as unknown as { __kbFrames: { path: string; drawn: boolean }[] }).__kbFrames,
  );
}

test("a days-on load at the root draws today first, never the root", async ({ page, request }) => {
  await call(request, "extension.switch", { name: "days", on: true });
  await recordFrames(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/node\/days\.\d{4}-\d{2}-\d{2}$/u);
  await expect(page.locator("[data-zoom-title]")).toBeVisible();
  const frames = await framesOf(page);
  // The workspace was held while the landing was asked, then drawn at today.
  expect(frames.some((f) => f.path === "/" && !f.drawn)).toBe(true);
  expect(frames.filter((f) => f.drawn && f.path === "/")).toEqual([]);
  // Back leaves the page rather than returning to a root that would land again.
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
});

test("a link names its own place, and wins over the landing", async ({ page, request }) => {
  await call(request, "extension.switch", { name: "days", on: true });
  await recordFrames(page);
  await page.goto(`/node/${ROOT}`);
  await expect(page.locator("[data-zoom-title]")).toHaveText("Fixture root");
  const frames = await framesOf(page);
  expect(frames.every((f) => f.path === `/node/${ROOT}`)).toBe(true);
});
