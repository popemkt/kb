// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Paste into a row, end to end (DESIGN-UI.md → Paste and drop). A pasted
// list is the outline's: its items become nodes after the row, through
// `node.addTree`, in one transaction. A pasted list of ratings is claimed
// first by the test kit's example extension, installed and trusted in the
// scratch root, whose handler sits before the outline's: each item becomes
// a node rated as it says, its guard holding the ratings to their form.
// Prose is the browser's. The store is read back over the API.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

test.use({ harnessOptions: { example: true } });

const ROOT = "render.fixture.root";
const RATING = "example.f.rating";

interface Stored {
  readonly text: string;
  readonly props: Record<string, unknown>;
  readonly children: readonly string[];
}

/** Run kb action `id` over the API; its output. */
async function call(request: APIRequestContext, id: string, input: unknown): Promise<unknown> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: unknown };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output;
}

/** A node as the store holds it now, its children by id. */
async function stored(request: APIRequestContext, id: string): Promise<Stored> {
  const { node } = (await call(request, "node.get", { id })) as {
    node: { text: string; props: Record<string, unknown>; children: readonly { id: string }[] };
  };
  return { text: node.text, props: node.props, children: node.children.map((child) => child.id) };
}

/** The texts of the root's children from `from` on, each with its own children's texts. */
async function rowsFrom(request: APIRequestContext, from: string): Promise<unknown[]> {
  const { children } = await stored(request, ROOT);
  const rows = children.slice(children.indexOf(from));
  return Promise.all(
    rows.map(async (id) => {
      const row = await stored(request, id);
      const nested = await Promise.all(
        row.children.map(async (c) => (await stored(request, c)).text),
      );
      return nested.length === 0 ? row.text : [row.text, nested];
    }),
  );
}

/** Add a row of `text` as the root's last child, open the root's page, and edit the row. */
async function editNewRow(page: Page, request: APIRequestContext, text: string): Promise<string> {
  const { id } = (await call(request, "node.add", { text, parent: ROOT })) as { id: string };
  await page.goto(`/node/${ROOT}`);
  await expect(page.locator('[data-example="section"]')).toBeVisible();
  await page.locator(`[data-node-id="${id}"] .node-content`).first().click();
  await expect(page.locator(`[data-node-id="${id}"][data-active="true"]`)).toBeVisible();
  return id;
}

/** Paste `text` as plain text into the row being edited, as the browser hands it to the page. */
async function paste(page: Page, id: string, text: string): Promise<void> {
  await page
    .locator(`[data-node-id="${id}"] [role="textbox"][contenteditable]`)
    .first()
    .evaluate((editor, pasted) => {
      const data = new DataTransfer();
      data.setData("text/plain", pasted);
      editor.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
}

test("a pasted list becomes nodes after the row, nested as it nests", async ({ page, request }) => {
  const row = await editNewRow(page, request, "A host row");
  await paste(page, row, "- one\n  - nested\n* two");
  await expect
    .poll(() => rowsFrom(request, row))
    .toEqual(["A host row", ["one", ["nested"]], "two"]);
});

test("a list pasted into an empty row takes its place", async ({ page, request }) => {
  const before = (await stored(request, ROOT)).children.length;
  const row = await editNewRow(page, request, "");
  await paste(page, row, "- first\n- second");
  await expect.poll(async () => (await stored(request, ROOT)).children.length).toBe(before + 2);
  const { children } = await stored(request, ROOT);
  expect(children).not.toContain(row);
  expect((await stored(request, children.at(-2) ?? "")).text).toBe("first");
});

test("an extension's handler claims its own pastes first, and kb writes what it makes", async ({
  page,
  request,
}) => {
  const row = await editNewRow(page, request, "Books");
  await paste(page, row, "- Dune (4/5)\n- Piranesi (5/5)");
  await expect.poll(() => rowsFrom(request, row)).toEqual(["Books", "Dune", "Piranesi"]);
  const { children } = await stored(request, ROOT);
  const rated = children.slice(-2);
  const ratings = await Promise.all(
    rated.map(async (id) => (await stored(request, id)).props[RATING]),
  );
  expect(ratings).toEqual([[{ t: "num", v: 4 }], [{ t: "num", v: 5 }]]);
});

test("prose is the browser's: no node is made of it", async ({ page, request }) => {
  const row = await editNewRow(page, request, "Notes");
  const before = (await stored(request, ROOT)).children.length;
  await paste(page, row, "Issue #12\nis fixed");
  await page.keyboard.press("Escape");
  expect((await stored(request, ROOT)).children.length).toBe(before);
});
