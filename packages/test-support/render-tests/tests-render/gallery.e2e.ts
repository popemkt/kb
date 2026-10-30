// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The gallery in a real browser: switched on as a person does, started from
// its starter library, a prompt composed from two facets and taken to the
// online sources, and a saved visual found in the virtualised grid and
// opened. The unit suites hold the readings and the layout arithmetic; this
// is where they meet the page, the replica and the asset route.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const runtimeErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  // The gallery is an optional extension, off by default: switch it on in
  // Settings' Extensions and wait for the server to report it loaded.
  await page.goto("/settings/extensions");
  const gallery = page.getByTestId("extension-gallery");
  await gallery.getByTestId("switch-gallery").selectOption("on");
  await expect(gallery.getByText("off: contributes nothing", { exact: true })).toHaveCount(0);
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], "gallery runtime errors").toEqual([]);
});

async function call(request: APIRequestContext, id: string, input: unknown): Promise<unknown> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; output?: unknown; message?: string };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output;
}

/** A 1×1 PNG. */
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("the starter library composes a prompt from two facets and takes it to the sources", async ({
  page,
  request,
}) => {
  await page.goto("/gallery");
  await page.getByTestId("gallery-starter").click();
  await expect(page.locator('[data-gallery-facet="Shot size"]')).toBeVisible();
  await expect(page.getByText(/^No visuals yet/)).toBeVisible();
  // Its Library is where saves go now: the setting names the node the store holds.
  await expect
    .poll(async () =>
      JSON.stringify(await call(request, "node.get", { id: "sys.extension.gallery" })),
    )
    .toContain("sys.f.gallery.save-into");

  await page.locator('[data-gallery-style="golden hour"]').click();
  await page.locator('[data-gallery-style="close-up"]').click();
  await page.getByLabel("Subject").fill("a lighthouse");
  // Facet order, not click order: Shot size comes before Lighting.
  await expect(page.locator('[data-gallery-output="Prompt"]')).toHaveText(
    "a lighthouse, close-up, golden hour",
  );

  await page.getByRole("tab", { name: "Sources" }).click();
  await expect(page.getByLabel("Look for")).toHaveValue("close-up golden hour");
  const pinterest = page.getByRole("link", { name: /^Pinterest/ });
  await expect(pinterest).toHaveAttribute("href", /q=close-up%20golden%20hour$/);
  await expect(pinterest).toHaveAttribute("target", "_blank");
});

test("a visual shows in the grid with its image, and opens in its detail", async ({
  page,
  request,
}) => {
  const asset = (await call(request, "asset.upload", {
    bytes: PIXEL,
    encoding: "base64",
    ext: "png",
  })) as { path: string };
  await call(request, "node.add", {
    text: "Dusk over the bay",
    tags: ["sys.tag.visual"],
    props: [
      { field: "sys.f.gallery.media", value: { t: "str", v: `![Dusk](${asset.path})` } },
      { field: "sys.f.gallery.prompt", value: { t: "str", v: "a bay at dusk, long exposure" } },
      { field: "sys.f.gallery.width", value: { t: "num", v: 3 } },
      { field: "sys.f.gallery.height", value: { t: "num", v: 2 } },
    ],
  });

  await page.goto("/gallery");
  const tile = page.locator("[data-gallery-tile]").filter({ hasText: "Dusk over the bay" });
  await expect(tile).toBeVisible();
  await expect
    .poll(() => tile.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await expect(page.getByTestId("gallery-count")).toHaveText("1 visual");

  await tile.click();
  const detail = page.getByTestId("gallery-detail");
  await expect(detail.getByRole("heading", { name: "Dusk over the bay" })).toBeVisible();
  await expect(detail.getByText("a bay at dusk, long exposure")).toBeVisible();
});

test("a phone shows one pane at a time, and an empty library leads to the sources", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/gallery");
  await page.getByTestId("gallery-starter").click();
  // The visuals first; the facets are a tab of their own, not a column beside them.
  await expect(page.getByRole("tab", { name: "Visuals" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-gallery-facet="Shot size"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Find references in the sources" }).click();
  await expect(page.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("gallery-sources")).toBeVisible();

  await page.getByRole("tab", { name: "Facets" }).click();
  await page.locator('[data-gallery-style="close-up"]').click();
  await page.getByRole("tab", { name: "Compose" }).click();
  await page.getByLabel("Subject").fill("a lighthouse");
  await expect(page.locator('[data-gallery-output="Prompt"]')).toHaveText("a lighthouse, close-up");
});
