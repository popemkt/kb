// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Where the page opens, end to end (DESIGN.md → Provider roles, `ui.landing`;
// DESIGN-UI.md → Days, Node pages). A load at the root with days on draws
// today first: the workspace is held in its neutral state while the landing
// is asked, so no frame paints the root on the way. A link names its own
// place and wins. And a node found with ⌘K opens at its page, the keyboard
// on it, without the outline going home to reveal it. The harness's store
// has days switched off, so the specs switch it on over the API, as a
// person would.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const LEAF = "render.fixture.node.17";

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

test("Enter on a ⌘K hit opens the node's page, the keyboard on it", async ({ page, request }) => {
  // From another node's page, where revealing the hit in the outline used
  // to fail, and from which it used to go home first.
  await page.goto("/node/render.fixture.node.3");
  await expect(page.locator("[data-zoom-title]")).toBeVisible();
  await page.evaluate(() => {
    const paths: string[] = [];
    Object.assign(window, { __kbPaths: paths });
    const tick = () => {
      if (paths.at(-1) !== location.pathname) paths.push(location.pathname);
      requestAnimationFrame(tick);
    };
    tick();
  });

  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Search and open" });
  await expect(search).toBeVisible();
  await page.keyboard.type("Fixture node 17");
  await expect(search.locator(`[data-palette-row="${LEAF}"]`)).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/node/${LEAF.replaceAll(".", "\\.")}$`, "u"));
  const title = page.locator("[data-zoom-title]");
  await expect(title).toContainText("Fixture node 17");
  await expect(title).toBeFocused();
  const paths = await page.evaluate(() => (window as unknown as { __kbPaths: string[] }).__kbPaths);
  expect(paths).toEqual(["/node/render.fixture.node.3", `/node/${LEAF}`]);

  // The keyboard is on the node: Enter edits its title, the caret at its end.
  await page.keyboard.press("Enter");
  await page.keyboard.type("!");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => {
      const { node } = (await call(request, "node.get", { id: LEAF })) as {
        node: { text: string };
      };
      return node.text;
    })
    .toMatch(/^Fixture node 17 .*!$/u);
});
