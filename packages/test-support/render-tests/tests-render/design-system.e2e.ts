// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The design-system switch in a real engine. What each contributed system's
// sheet sets is held to its contract by
// `ui/src/design-system-point.contract.test.tsx`, which reads the CSS as data;
// what only a browser can show is that choosing a system in Settings →
// Appearance paints the whole page with it. The part draws core's design-system
// field with the page's field editor, which lays it out as a gallery: a
// card per option, each holding that system's live sample
// (`data-option-preview`, which carries `data-theme`, so the cascade that
// paints it is that system's sheet). So for every system the gallery offers,
// in light and in dark, the root's computed `--background` and `--primary`
// must equal the ones the chosen card's sample resolves, and no two systems
// may paint the root alike.
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const TOKENS = ["--background", "--primary"] as const;
const GALLERY = '[data-option-gallery="sys.f.design-system"]';

/** The design-system field's gallery in Settings → Appearance: its cards. */
async function cards(page: Page) {
  const gallery = page.locator(GALLERY);
  await expect(gallery).toBeVisible();
  const found = gallery.locator('[role="radio"]:has([data-option-preview])');
  await expect(found.first()).toBeVisible();
  return found;
}

/** The tokens as the root computes them, and as the chosen card's sample computes them. */
async function paint(page: Page) {
  return page.evaluate(
    ({ tokens, gallery }) => {
      const read = (el: Element) =>
        tokens.map((token) => getComputedStyle(el).getPropertyValue(token).trim());
      const swatch = document.querySelector(
        `${gallery} [aria-checked="true"] [data-option-preview]`,
      );
      if (swatch === null) throw new Error("the chosen system shows no sample");
      return {
        theme: document.documentElement.getAttribute("data-theme"),
        swatchOf: swatch.getAttribute("data-option-preview"),
        root: read(document.documentElement),
        swatch: read(swatch),
      };
    },
    { tokens: [...TOKENS], gallery: GALLERY },
  );
}

for (const scheme of ["light", "dark"] as const) {
  test(`every design system paints the page it is chosen for (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/settings/appearance");
    const ids = await (
      await cards(page)
    ).evaluateAll((rows) =>
      rows.map(
        (row) =>
          row.querySelector("[data-option-preview]")?.getAttribute("data-option-preview") ?? "",
      ),
    );
    expect(ids.length).toBeGreaterThan(1);

    const painted = new Map<string, string>();
    for (const id of ids) {
      await (
        await cards(page)
      )
        .filter({ has: page.locator(`[data-option-preview="${id}"]`) })
        .click();
      await expect.poll(() => paint(page).then((p) => [p.theme, p.swatchOf])).toEqual([id, id]);
      const now = await paint(page);
      expect(
        now.root.every((value) => value !== ""),
        `${id}: tokens resolve`,
      ).toBe(true);
      expect(now.root, `${id}: the root is painted by ${id}'s sheet`).toEqual(now.swatch);
      painted.set(id, now.root.join(" | "));
    }
    // A switch that changed nothing would pass the check above for every id.
    expect(new Set(painted.values()).size, JSON.stringify([...painted])).toBe(ids.length);

    // The choice is core's setting, and the painter's record paints it again
    // before the graph loads: it survives a reload.
    const last = ids.at(-1) ?? "";
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBe(last);
  });
}
