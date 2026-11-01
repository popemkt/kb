// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The gallery in a real browser: switched on as a person does, started from
// its starter library and its pictures, asked where to start, and each way
// in making the one look beside it: a prompt composed from two facets and taken to the online
// sources, a style named by its first letters, an idea named axis by axis
// and by reacting, a look saved with its pins and opened as a canvas
// moodboard, a phone showing one pane at a time. The unit suites hold the
// readings and the layout arithmetic; this is where they meet the page, the
// replica, the asset route and the canvas.
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

/** Add the starter, and wait for the chooser it leads to. */
async function starter(page: Page): Promise<void> {
  await page.goto("/gallery");
  await page.getByTestId("gallery-starter").click();
  await expect(page.getByTestId("gallery-chooser")).toBeVisible();
}

async function addVisual(
  request: APIRequestContext,
  text: string,
  styles: readonly string[] = [],
): Promise<string> {
  const asset = (await call(request, "asset.upload", {
    bytes: PIXEL,
    encoding: "base64",
    ext: "png",
  })) as { path: string };
  const added = (await call(request, "node.add", {
    text,
    tags: ["sys.tag.visual"],
    props: [
      { field: "sys.f.gallery.media", value: { t: "str", v: `![${text}](${asset.path})` } },
      { field: "sys.f.gallery.prompt", value: { t: "str", v: "a bay at dusk, long exposure" } },
      { field: "sys.f.gallery.width", value: { t: "num", v: 3 } },
      { field: "sys.f.gallery.height", value: { t: "num", v: 2 } },
      ...styles.map((v) => ({ field: "sys.f.gallery.styles", value: { t: "ref", v } })),
    ],
  })) as { id: string };
  return added.id;
}

/** The id of the style called `text`. */
async function styleId(request: APIRequestContext, text: string): Promise<string> {
  const out = (await call(request, "graph.query", {
    query: `[:find ?id :where [?n :node/text "${text}"] [?n :node/id ?id]]`,
  })) as { rows: string[][] };
  return out.rows[0]?.[0] ?? "";
}

test("the starter asks where to start, and Browse composes a look from two facets", async ({
  page,
  request,
}) => {
  await starter(page);
  // Its Library is where saves go now: the setting names the node the store holds.
  await expect
    .poll(async () =>
      JSON.stringify(await call(request, "node.get", { id: "sys.extension.gallery" })),
    )
    .toContain("sys.f.gallery.save-into");
  await expect(page.locator("[data-gallery-workflow]")).toHaveCount(7);
  await page.locator('[data-gallery-workflow="browse"]').click();
  await expect(page).toHaveURL(/\/gallery\/browse$/);
  // The library starts with the starter's pictures, filed by its styles.
  await expect(page.getByTestId("gallery-count")).toHaveText("26 visuals");
  const wave = page
    .locator("[data-gallery-tile]")
    .filter({ hasText: "The Great Wave off Kanagawa" });
  await expect
    .poll(() => wave.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(1);
  await page.locator('[data-gallery-style="Ukiyo-e"]').click();
  await expect(page.getByTestId("gallery-count")).toHaveText("2 of 26");
  await page.locator('[data-gallery-style="Ukiyo-e"]').click();

  await page.locator('[data-gallery-style="golden hour"]').click();
  await page.locator('[data-gallery-style="close-up"]').click();
  await page.getByLabel("Brief").fill("a lighthouse");
  // Facet order, not click order: Shot size comes before Lighting.
  await expect(page.locator('[data-gallery-output="Prompt"]')).toHaveText(
    "a lighthouse, close-up, golden hour",
  );
  await page.getByRole("tab", { name: "Sources" }).click();
  await expect(page.getByLabel("Look for")).toHaveValue("close-up golden hour");
  const pinterest = page.getByRole("link", { name: /^Pinterest/ });
  await expect(pinterest).toHaveAttribute("href", /q=close-up%20golden%20hour$/);
  await expect(pinterest).toHaveAttribute("target", "_blank");

  // The look outlives the way in: another workflow shows the same look.
  await page.getByRole("tab", { name: "Compose" }).click();
  await expect(page.locator('[data-look-style="golden hour"]')).toBeVisible();
  // And /gallery offers the last workflow first.
  await page.goto("/gallery");
  await expect(page.locator("[data-gallery-workflow]").first()).toHaveAttribute(
    "data-gallery-workflow",
    "know",
  );
});

test("a visual shows in the grid with its image, opens in its detail, and pins to the look", async ({
  page,
  request,
}) => {
  await addVisual(request, "Dusk over the bay");
  await page.goto("/gallery/browse");
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
  await detail.getByTestId("gallery-pin").click();
  await expect(page.getByTestId("look-pins").getByRole("img")).toHaveCount(1);
});

test("Know completes a style from its first letters, and shows its references", async ({
  page,
  request,
}) => {
  await starter(page);
  await addVisual(request, "Blue bay", [await styleId(request, "blue hour")]);
  await page.locator('[data-gallery-workflow="know"]').click();
  await page.getByLabel("Name a style").fill("blue h");
  await expect(page.locator('[data-gallery-suggestion="blue hour"]')).toBeVisible();
  await page.getByLabel("Name a style").press("Enter");
  await expect(page.locator('[data-look-style="blue hour"]')).toBeVisible();
  await expect(page.getByTestId("know-said")).toHaveText("1 reference shows all of it");
  await expect(page.locator("[data-gallery-tile]")).toHaveCount(1);
});

test("Articulate names an idea by hand and by reacting, and the look saves with a canvas moodboard", async ({
  page,
  request,
}) => {
  await starter(page);
  const golden = await styleId(request, "golden hour");
  await addVisual(request, "Golden bay", [golden, await styleId(request, "wide shot")]);
  await page.locator('[data-gallery-workflow="articulate"]').click();
  await page.getByLabel("Describe it").fill("a lonely lighthouse, warm, quiet");
  // Every axis offers its styles to pick by hand, each a chip with its example.
  const lighting = page.locator('[data-gallery-axis="lighting"]');
  await lighting.locator('[data-gallery-chip="golden hour"]').click();
  await expect(page.locator('[data-look-style="golden hour"]')).toBeVisible();
  // React instead of naming: like the nearest reference, and its styles join the look.
  const card = page.locator("[data-gallery-react]").first();
  await card.getByRole("button", { name: "Like" }).click();
  await expect(page.locator('[data-look-style="wide shot"]')).toBeVisible();
  await page.getByLabel("Brief").fill("a lonely lighthouse");
  await page.getByLabel(/^Note on/).fill("the light from here");

  await page.getByRole("button", { name: "Moodboard" }).click();
  await expect(page).toHaveURL(/\/canvas\//);
  const looks = (await call(request, "graph.query", {
    query:
      '[:find ?id ?text :where [?t :node/id "sys.tag.look"] [?n :f/sys.f.type ?t] [?n :node/id ?id] [?n :node/text ?text]]',
  })) as { rows: string[][] };
  expect(looks.rows.map((row) => row[1])).toEqual(["a lonely lighthouse"]);
  const look = (await call(request, "node.get", { id: looks.rows[0]?.[0], depth: 1 })) as {
    node: { children: Array<{ text: string; props: Record<string, unknown> }> };
  };
  const texts = look.node.children.map((child) => child.text);
  expect(texts).toContain("the light from here");
  expect(look.node.children.some((child) => "sys.f.canvas" in child.props)).toBe(true);
});

test("a phone shows one pane at a time, the look a tab of its own", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await starter(page);
  await page.locator('[data-gallery-workflow="browse"]').click();
  // The visuals first; the facets are a tab of their own, not a column beside them.
  await expect(page.getByRole("tab", { name: "Visuals" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-gallery-facet="Shot size"]')).toHaveCount(0);
  await expect(page.getByTestId("gallery-count")).toHaveText("26 visuals");
  await page.getByRole("tab", { name: "Sources" }).click();
  await expect(page.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("gallery-sources")).toBeVisible();

  await page.getByRole("tab", { name: "Facets" }).click();
  await page.locator('[data-gallery-style="close-up"]').click();
  await page.getByRole("tab", { name: /^Look/ }).click();
  await page.getByLabel("Brief").fill("a lighthouse");
  await expect(page.locator('[data-gallery-output="Prompt"]')).toHaveText("a lighthouse, close-up");
});
