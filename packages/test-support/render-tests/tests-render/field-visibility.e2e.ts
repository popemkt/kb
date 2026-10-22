// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Whether a field is drawn is its field node's to say (DESIGN.md → Data
// model → field visibility): on a real page, a field's own cardinality and
// inverse, which `sys.field` templates, are rows a person edits, and an
// agent provider's adapter and endpoint are rows on the provider's page,
// while the type and template fields, whose seeded nodes say hidden, are not.
// Screenshots of both pages are written beside the run.
import { FIELD_TYPE_OPTION_IDS } from "@kb/model";
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const FIELD = "fv.f.influences";
const PROVIDER = "fv.provider";

const ref = (v: string) => ({ t: "ref", v });

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
