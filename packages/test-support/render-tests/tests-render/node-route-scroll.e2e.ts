// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A node page opened as the entry URL scrolls under the wheel. Its route used
// to frame the page in a fixed region and the page then framed itself in a
// scroll region inside it, so the inner region grew to its content's height,
// the outer one clipped it, and nothing scrolled. Whether a box scrolls is a
// question only a real engine laying out real boxes can answer.
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const ROWS = 80;

/** Each main landmark on the page, with how far it has scrolled and could scroll. */
function regions(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("main")].map((main) => ({
      region: main.getAttribute("data-main-region"),
      scrollTop: main.scrollTop,
      overflow: main.scrollHeight - main.clientHeight,
    })),
  );
}

test("a node page opened directly scrolls under the wheel", async ({ page, request }) => {
  for (let i = 0; i < ROWS; i++) {
    const res = await request.post("/api/action", {
      data: { id: "node.add", input: { id: `scroll.row.${i}`, text: `Row ${i}`, parent: ROOT } },
    });
    expect((await res.json()).status).toBe("succeeded");
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/node/${ROOT}`);
  await expect(page.getByText(`Row ${ROWS - 1}`, { exact: true })).toBeAttached();

  // One region frames the page, and its content is taller than it.
  await expect.poll(async () => (await regions(page)).length).toBe(1);
  const [before] = await regions(page);
  expect(before?.region).toBe("scroll");
  expect(before?.overflow).toBeGreaterThan(0);

  await page.mouse.move(640, 500);
  await page.mouse.wheel(0, 800);
  await expect.poll(async () => (await regions(page))[0]?.scrollTop ?? 0).toBeGreaterThan(0);
});

test("a node page for a missing node is still the page's one main region", async ({ page }) => {
  await page.goto("/node/no.such.node");
  await expect(page.getByText("Node not found")).toBeVisible();
  expect((await regions(page)).map(({ region }) => region)).toEqual(["scroll"]);
});
