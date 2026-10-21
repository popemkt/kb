// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Every navigation is in the URL. Zooming the outline is going somewhere, so
// it pushes a location: back and forward walk it, and a reload or a link
// lands where the page was. Whether the address bar, history and a reload
// agree is a question only a real browser answers.
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";

/** The zoomed outline's header, standing at `id`. */
function zoomedAt(page: Page, id: string) {
  return page.locator(`[data-zoomed-root-header="true"][data-frame-id="${id}"]`);
}

test("zooming the outline pushes its location, which back, forward and reload restore", async ({
  page,
}) => {
  await page.goto("/");
  const bullet = page.locator(`[data-node-id="${ROOT}"] [data-bullet-kind]`).first();
  await expect(bullet).toBeVisible();

  // A modifier click on a bullet opens the node: at `/`, a zoom.
  await bullet.click({ modifiers: ["ControlOrMeta"] });
  await expect(page).toHaveURL(`/outline/${ROOT}`);
  await expect(zoomedAt(page, ROOT)).toBeVisible();

  // A reload lands at the zoom.
  await page.reload();
  await expect(zoomedAt(page, ROOT)).toBeVisible();

  // Back returns home, forward to the zoom.
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(page.locator("[data-zoomed-root-header]")).toHaveCount(0);
  await expect(bullet).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(`/outline/${ROOT}`);
  await expect(zoomedAt(page, ROOT)).toBeVisible();
});

test("a link to a zoom of a node that is not there lands at home", async ({ page }) => {
  await page.goto("/outline/no.such.node");
  await expect(page).toHaveURL("/");
  await expect(page.locator(`[data-node-id="${ROOT}"]`).first()).toBeVisible();
});
