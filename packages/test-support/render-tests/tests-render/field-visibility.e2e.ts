// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Whether a field is drawn is its field node's to say (DESIGN.md → Data
// model → field visibility): on a real page, a field's own cardinality and
// inverse, which `sys.field` templates, are rows a person edits, and an
// agent provider's adapter and endpoint are rows on the provider's page,
// while the type and template fields, whose seeded nodes say hidden, are not;
// and a node's hidden fields are one line of chips after its rows (DESIGN-UI.md
// → Field values → hidden fields chips).
// Screenshots of both pages are written beside the run.
import { FIELD_TYPE_OPTION_IDS } from "@kb/model";
import type { APIRequestContext, Locator, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const FIELD = "fv.f.influences";
const PROVIDER = "fv.provider";

const ref = (v: string) => ({ t: "ref", v });

/** Where `locator` is drawn; a test fails when it is not drawn at all. */
async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Wait out the page's enter transition, so a screenshot shows it settled. */
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );

test("a system field its node does not hide is a row a person edits", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const action = async (id: string, input: Record<string, unknown>) => {
    const response = await request.post("/api/action", { data: { id, input } });
    const receipt = await response.json();
    expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
    return receipt;
  };

  await action("node.add", {
    id: FIELD,
    text: "influences",
    parent: ROOT,
    props: [
      { field: "sys.f.type", value: ref("sys.field") },
      { field: "sys.f.fieldType", value: ref(FIELD_TYPE_OPTION_IDS.ref) },
    ],
  });
  await action("node.add", {
    id: PROVIDER,
    text: "Local model",
    parent: ROOT,
    props: [{ field: "sys.f.type", value: ref("sys.tag.agent-provider") }],
  });

  // The field's page: its type, cardinality, constraints and inverse, and no
  // row for the kind slot.
  await page.goto(`/node/${FIELD}`);
  const fields = page.locator(`[data-fields-for="${FIELD}"]`).first();
  await expect(fields).toBeVisible();
  for (const label of ["fieldType", "cardinality", "targetTag", "targetQuery", "inverse"]) {
    await expect(fields.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(fields.getByText("type", { exact: true })).toHaveCount(0);
  await expect(fields.getByText("fields", { exact: true })).toHaveCount(0);

  // The inverse is written from its row, like any text field.
  const inverse = fields.locator("[data-field-row]").filter({ hasText: "inverse" }).first();
  await inverse.locator("[data-value-slot]").first().click();
  await page.keyboard.type("influenced by");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => {
      const response = await request.post("/api/action", {
        data: { id: "node.get", input: { id: FIELD } },
      });
      return JSON.stringify(await response.json());
    })
    .toContain("influenced by");
  await page.mouse.click(1200, 880);
  await settled(page);
  await page.screenshot({ path: testInfo.outputPath("field-page.png") });

  // The provider's page: every field its tag templates is a row.
  await page.goto(`/node/${PROVIDER}`);
  const provider = page.locator(`[data-fields-for="${PROVIDER}"]`).first();
  await expect(provider).toBeVisible();
  for (const label of ["adapter", "endpoint", "credential", "executable", "model"]) {
    await expect(provider.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await settled(page);
  await page.screenshot({ path: testInfo.outputPath("agent-provider-page.png") });

  expect(errors).toEqual([]);
});

/**
 * A tag `<p>.t.item` templating `area` (always), `note` (when filled),
 * `source` and `archived` (hidden), and `budget` and `venue` (tucked), and
 * a node `<p>.n.item` holding `area`: two chips and a "…" for two.
 */
async function seedItem(request: APIRequestContext, p: string) {
  const action = async (id: string, input: Record<string, unknown>) => {
    const response = await request.post("/api/action", { data: { id, input } });
    const receipt = await response.json();
    expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
  };
  const fields = [
    ["area", undefined],
    ["note", "sys.show.filled"],
    ["source", "sys.show.hidden"],
    ["archived", "sys.show.hidden"],
    ["budget", "sys.show.tucked"],
    ["venue", "sys.show.tucked"],
  ] as const;
  for (const [name, show] of fields)
    await action("node.add", {
      id: `${p}.f.${name}`,
      text: name,
      parent: ROOT,
      props: [
        { field: "sys.f.type", value: ref("sys.field") },
        { field: "sys.f.fieldType", value: ref(FIELD_TYPE_OPTION_IDS.text) },
        ...(show === undefined ? [] : [{ field: "sys.f.show", value: ref(show) }]),
      ],
    });
  await action("node.add", {
    id: `${p}.t.item`,
    text: "item",
    parent: ROOT,
    props: [
      { field: "sys.f.type", value: ref("sys.tag") },
      ...fields.map(([name]) => ({ field: "sys.f.fields", value: ref(`${p}.f.${name}`) })),
    ],
  });
  await action("node.add", {
    id: `${p}.n.item`,
    text: "an item",
    parent: ROOT,
    props: [
      { field: "sys.f.type", value: ref(`${p}.t.item`) },
      { field: `${p}.f.area`, value: { t: "str", v: "ops" } },
    ],
  });
}

test("hidden fields are one line of chips on a field row's geometry", async ({
  page,
  request,
}, testInfo) => {
  await seedItem(request, "hc1");
  await page.goto(`/node/hc1.n.item`);
  const fields = page.locator(`[data-fields-for="hc1.n.item"]`).first();
  const line = fields.locator("[data-hidden-fields]").first();
  await expect(line).toHaveAttribute("aria-label", "Hidden fields: note, source, archived");
  await expect(line.locator("[data-field-chip]")).toHaveText(["note", "source", "archived"]);
  await expect(line.locator("[data-tucked-fields]")).toHaveAttribute("aria-label", "2 more fields");
  const row = fields.locator("[data-field-row]").filter({ hasText: "area" }).first();
  const rowBox = await box(row);
  const lineBox = await box(line);
  const first = line.locator("[data-field-chip]").first();
  const glyph = await box(row.locator("svg").first());
  const chipGlyph = await box(first.locator("svg").first());
  const label = await box(row.getByText("area", { exact: true }).first());
  const chipName = await box(first.getByText("note", { exact: true }));
  // As tall as a field row, the first chip's icon centred in the glyph
  // column, and its name where field labels start.
  expect(lineBox.height).toBeCloseTo(rowBox.height, 0);
  expect(chipGlyph.x + chipGlyph.width / 2).toBeCloseTo(glyph.x + glyph.width / 2, 0);
  expect(chipName.x).toBeCloseTo(label.x, 0);
  await settled(page);
  await fields.screenshot({ path: testInfo.outputPath("hidden-fields-chips.png") });
});

test("a chip opens its field with the keyboard on its value, and Escape closes it again", async ({
  page,
  request,
}) => {
  await seedItem(request, "hc2");
  await page.goto(`/node/hc2.n.item`);
  const fields = page.locator(`[data-fields-for="hc2.n.item"]`).first();
  const chip = (name: string) => fields.locator("[data-field-chip]").filter({ hasText: name });
  await chip("source").click();
  const value = fields.locator(`[data-field-values="hc2.f.source"] [data-value-slot]`).first();
  await expect(value).toBeFocused();
  await expect(fields.locator("[data-field-chip]")).toHaveText(["note", "archived"]);
  await page.keyboard.press("Escape");
  await expect(fields.locator(`[data-field-values="hc2.f.source"]`)).toHaveCount(0);
  await expect(fields.locator("[data-field-chip]")).toHaveText(["note", "source", "archived"]);
  await expect(chip("source")).toBeFocused();
});

test("the keyboard walks the chips with ←/→ and opens … in place", async ({ page, request }) => {
  await seedItem(request, "hc3");
  await page.goto(`/node/hc3.n.item`);
  const fields = page.locator(`[data-fields-for="hc3.n.item"]`).first();
  const chip = (name: string) => fields.locator("[data-field-chip]").filter({ hasText: name });
  const more = fields.locator("[data-tucked-fields]");
  await chip("note").focus();
  await page.keyboard.press("ArrowRight");
  await expect(chip("source")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(more).toHaveCount(0);
  await expect(fields.locator("[data-field-chip]")).toHaveText([
    "note",
    "source",
    "archived",
    "budget",
    "venue",
  ]);
  await expect(chip("budget")).toBeFocused();
  // ↑ leaves the line for the value above it.
  await page.keyboard.press("ArrowUp");
  await expect(
    fields.locator(`[data-field-values="hc3.f.area"] [data-value-slot]`).first(),
  ).toBeFocused();
});

test("at 360px the chips wrap inside the pane, and nothing overflows", async ({
  page,
  request,
}, testInfo) => {
  await seedItem(request, "hc4");
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto(`/node/hc4.n.item`);
  const fields = page.locator(`[data-fields-for="hc4.n.item"]`).first();
  const line = fields.locator("[data-hidden-fields]").first();
  await line.locator("[data-tucked-fields]").click();
  const row = fields.locator("[data-field-row]").filter({ hasText: "area" }).first();
  const lineBox = await box(line);
  // More than one line, each a field row's height.
  expect(lineBox.height).toBeGreaterThan((await box(row)).height * 1.5);
  const overflow = await line.evaluate((el) => {
    const right = el.getBoundingClientRect().right;
    return [...el.children].some((chip) => chip.getBoundingClientRect().right > right + 0.5);
  });
  expect(overflow).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await settled(page);
  await fields.screenshot({ path: testInfo.outputPath("hidden-fields-chips-360.png") });
});
