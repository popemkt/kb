// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The query builder in a real page (docs/brainstorms/2026-10-20-query-builder):
// a query node made with the default query is built up from the keyboard
// and the pointer into the sentence the mockup draws — has tag todo, status
// is not Done, any of two texts — and at each step the results and the
// count are what the stored query answers. Screenshots of the Conditions and
// EDN tabs, and of the mockup, are written beside the run for comparison.
import { fileURLToPath } from "node:url";
import { FIELD_TYPE_OPTION_IDS } from "@kb/model";
import type { Locator, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const QUERY = "qb.query";
const MOCKUP = fileURLToPath(
  new URL("../../../../docs/brainstorms/2026-10-20-query-builder/mockup.html", import.meta.url),
);

const ref = (v: string) => ({ t: "ref", v });

/** The slot whose accessible name starts with `name` ("field", "operator: is"). */
const slot = (scope: Locator, name: string) =>
  scope
    .locator("[data-qb-slot]")
    .and(scope.locator(`[aria-label^="${name}"]`))
    .first();

/**
 * Type into the picker the last gesture opened, and take the row named
 * `text` once it is offered: Enter takes the active row, and a picker still
 * gathering its candidates offers to create what was typed.
 */
async function pickTyped(page: Page, text: string) {
  await expect(page.locator("input:focus")).toHaveCount(1);
  await page.keyboard.type(text);
  const exact = new RegExp(`^\\s*${text}\\s*$`);
  await expect(page.locator('[role="option"]').filter({ hasText: exact }).first()).toBeVisible();
  await page.keyboard.press("Enter");
}

test("a query is built in the builder, and its results and count follow every condition", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const action = async (id: string, input: Record<string, unknown>) => {
    const response = await request.post("/api/action", { data: { id, input } });
    const receipt = await response.json();
    expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
  };

  await action("node.add", {
    id: "qb.f.status",
    text: "status",
    parent: ROOT,
    props: [
      { field: "sys.f.type", value: ref("sys.field") },
      { field: "sys.f.fieldType", value: ref(FIELD_TYPE_OPTION_IDS.ref) },
    ],
  });
  for (const [id, text] of [
    ["qb.s.doing", "Doing"],
    ["qb.s.done", "Done"],
  ] as const) {
    await action("node.add", { id, text, parent: "qb.f.status" });
  }
  await action("node.add", {
    id: "qb.t.todo",
    text: "todo",
    parent: ROOT,
    props: [
      { field: "sys.f.type", value: ref("sys.tag") },
      { field: "sys.f.fields", value: ref("qb.f.status") },
    ],
  });
  for (const [id, text, status] of [
    ["qb.n.socket", "Ship socket listener", "qb.s.doing"],
    ["qb.n.panel", "Extensions panel review", "qb.s.doing"],
    ["qb.n.spike", "Query builder spike", "qb.s.done"],
  ] as const) {
    await action("node.add", {
      id,
      text,
      parent: ROOT,
      props: [
        { field: "sys.f.type", value: ref("qb.t.todo") },
        { field: "qb.f.status", value: ref(status) },
      ],
    });
  }
  await action("node.add", { id: "qb.n.retro", text: "Retro notes", parent: ROOT });
  await action("node.add", {
    id: QUERY,
    text: "Open work",
    position: 0,
    props: [
      { field: "sys.f.query", value: { t: "str", v: "[:find ?id :where [?n :node/id ?id]]" } },
    ],
  });

  await page.goto("/");
  const query = page.locator(`[data-node-id="${QUERY}"]`).first();
  await expect(query).toBeVisible();
  await query.getByRole("button", { name: "Expand results" }).first().click();
  const builder = page.locator(`[data-query-builder="${QUERY}"]`);
  const count = builder.locator("[data-qb-count]");
  const results = page.locator(`[data-query-results-for="${QUERY}"]`);
  const shown = (id: string) => results.locator(`[data-node-id="${id}"]`).first();

  // A new query node opens on Conditions, saying nothing: every node counts.
  await expect(builder.getByRole("tab", { name: "Conditions" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(builder).toContainText("No conditions: every node matches.");
  await expect(count).toHaveText(/^\d+ nodes$/);

  // has tag todo: from the keyboard, slot by slot.
  await builder.locator('[data-qb-slot="add-condition"]').first().click();
  await pickTyped(page, "has tag");
  await pickTyped(page, "todo");
  await expect(count).toHaveText("3 nodes");
  await expect(count).toHaveAttribute("data-qb-count", "current");
  for (const id of ["qb.n.socket", "qb.n.panel", "qb.n.spike"])
    await expect(shown(id)).toBeVisible();
  await expect(shown("qb.n.retro")).toHaveCount(0);

  // status is not Done: the field's values first, then its operator.
  await builder.locator('[data-qb-slot="add-condition"]').last().click();
  await pickTyped(page, "status");
  await pickTyped(page, "Done");
  await page.keyboard.press("Escape");
  await expect(count).toHaveText("1 node");
  await slot(builder, "operator: is").click();
  await pickTyped(page, "is not");
  await expect(count).toHaveText("2 nodes");
  await expect(shown("qb.n.spike")).toHaveCount(0);

  // any of: text contains "socket", or text contains "review".
  await builder.locator('[data-qb-slot="add-group"]').last().click();
  const group = builder.locator("[data-qb-group]").first();
  await pickTyped(page, "text");
  await page.keyboard.type("socket");
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("1 node");
  await group.locator('[data-qb-slot="add-condition"]').click();
  await pickTyped(page, "text");
  await page.keyboard.type("review");
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("2 nodes");
  await expect(shown("qb.n.socket")).toBeVisible();
  await expect(shown("qb.n.panel")).toBeVisible();

  // Every slot is a named button.
  for (const name of [
    "condition: has tag",
    "tag: todo",
    "field: status",
    "operator: is not",
    "group: any of",
  ]) {
    await expect(slot(builder, name)).toBeVisible();
  }
  await page.mouse.click(1200, 880);
  await builder.screenshot({ path: testInfo.outputPath("query-builder-conditions.png") });
  await page.screenshot({ path: testInfo.outputPath("query-builder-page.png") });

  // The EDN tab holds the canonical text the conditions wrote.
  await builder.getByRole("tab", { name: "EDN" }).click();
  const edn = builder.getByRole("textbox", { name: "Query (EDN)" });
  await expect(edn).toHaveValue(/\[\?n :f\/sys\.f\.type \?v1\]/);
  await expect(edn).toHaveValue(/not-join \[\?n\]/);
  await expect(edn).toHaveValue(/or-join \[\?n\]/);
  await builder.screenshot({ path: testInfo.outputPath("query-builder-edn.png") });

  await page.goto(`file://${MOCKUP}`);
  await page.screenshot({ path: testInfo.outputPath("mockup.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("a query that says something is tucked away: its results are the content, its query one click away", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const action = async (id: string, input: Record<string, unknown>) => {
    const response = await request.post("/api/action", { data: { id, input } });
    const receipt = await response.json();
    expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
  };
  for (const [id, text] of [
    ["tq.n.alpha", "Alpha review"],
    ["tq.n.beta", "Beta review"],
    ["tq.n.other", "Unrelated"],
  ] as const) {
    await action("node.add", { id, text, parent: ROOT });
  }
  const id = "tq.query";
  await action("node.add", {
    id,
    text: "Reviews",
    position: 0,
    props: [
      {
        field: "sys.f.query",
        value: {
          t: "str",
          v: '[:find ?id :where [?n :node/id ?id] [?n :node/text ?t] [(clojure.string/includes? ?t "review")]]',
        },
      },
    ],
  });

  await page.goto("/");
  const row = page.locator(`[data-node-block][data-node-id="${id}"]`).first();
  await row.getByRole("button", { name: "Expand results" }).first().click();
  const results = page.locator(`[data-query-results-for="${id}"]`).first();
  const builder = page.locator(`[data-query-builder="${id}"]`);
  await expect(results.locator('[data-node-block][data-node-id="tq.n.alpha"]')).toBeVisible();
  await expect(builder).toHaveCount(0);

  // The control sits beside the node, in its view toolbar, and reaches it from the keyboard.
  const toggle = row.locator(`[data-query-toggle="${id}"]`).first();
  await toggle.focus();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(builder).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({ path: testInfo.outputPath("query-tucked-open.png") });
  await toggle.click();
  await expect(builder).toHaveCount(0);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: testInfo.outputPath("query-tucked.png") });

  // Zoomed in, the page is the query's results, its builder behind the header's control.
  await row
    .locator("button.bullet-container")
    .first()
    .click({ modifiers: ["ControlOrMeta"] });
  const header = page.locator("[data-zoomed-root-header]");
  await expect(header).toContainText("Reviews");
  const pageResults = page.locator(`[data-query-results-for="${id}"]`);
  await expect(pageResults.locator('[data-node-block][data-node-id="tq.n.beta"]')).toBeVisible();
  await expect(pageResults.locator('[data-node-block][data-node-id="tq.n.other"]')).toHaveCount(0);
  await expect(page.locator(`[data-create-child-zone="${id}"]`)).toHaveCount(0);
  await header.hover();
  await header.locator(`[data-query-toggle="${id}"]`).click();
  await expect(builder).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("query-page-open.png") });
  expect(errors).toEqual([]);
});
