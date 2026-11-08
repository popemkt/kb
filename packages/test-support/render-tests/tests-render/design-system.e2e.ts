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

/**
 * Read a completed paint. The gallery can commit before the native snapshot
 * invokes the painter; style reads belong after that update, including when
 * the visual transition is skipped. Callback failures remain test failures.
 * Relies on transitionTheme starting synchronously from the graph subscription,
 * before React can show the gallery choice.
 */
async function paint(page: Page) {
  await page.evaluate(() => document.activeViewTransition?.updateCallbackDone);
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
      const choice = (await cards(page)).filter({
        has: page.locator(`[data-option-preview="${id}"]`),
      });
      await choice.click();
      await expect(choice).toHaveAttribute("aria-checked", "true");
      const now = await paint(page);
      expect([now.theme, now.swatchOf]).toEqual([id, id]);
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

type PaintControlWindow = Window & { releaseThemePaint?: () => void };

for (const presentation of ["animated", "skipped"] as const) {
  test(`a selected design system is measured after its native snapshot update (${presentation})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings/appearance");
    await cards(page);
    const unchosen = page
      .locator(`${GALLERY} [role="radio"][aria-checked="false"]:has([data-option-preview])`)
      .first();
    const id = await unchosen.locator("[data-option-preview]").getAttribute("data-option-preview");
    const choice = (await cards(page)).filter({
      has: page.locator(`[data-option-preview="${id}"]`),
    });
    const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    await page.evaluate(() => {
      const native = document.startViewTransition.bind(document);
      const gate = Promise.withResolvers<void>();
      (window as PaintControlWindow).releaseThemePaint = () => gate.resolve();
      document.startViewTransition = (update) => {
        if (typeof update !== "function") return native(update);
        return native(async () => {
          await gate.promise;
          return update();
        });
      };
    });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(
      before,
    );
    if (presentation === "skipped") {
      await page.evaluate(() => document.activeViewTransition?.skipTransition());
    }
    let measured = false;
    const measurement = paint(page).then((value) => {
      measured = true;
      return value;
    });
    await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    try {
      expect(measured, "a pending snapshot must not be measured as a completed paint").toBe(false);
    } finally {
      await page.evaluate(() => (window as PaintControlWindow).releaseThemePaint?.());
    }
    const after = await measurement;
    expect([after.theme, after.swatchOf]).toEqual([id, id]);
    expect(after.root).toEqual(after.swatch);
  });
}
