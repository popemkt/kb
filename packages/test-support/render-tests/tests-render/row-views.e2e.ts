// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A tag's row view, end to end (DESIGN-UI.md → Row views): the test kit's
// example extension, installed and trusted in the scratch root, seeds
// `#noted` and draws its rows as a note. In a real browser at a narrow
// width, a `#noted` row is drawn as that note around its own wrapped text;
// a press inside that text edits the row at the character pressed, the edit
// reaches the store, and the note is back once the edit ends. Its inline
// reference still navigates, and a contextual reference to it is drawn as
// the note too, writing to the node it shows rather than to itself.
import type { APIRequestContext, Locator, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

test.use({ harnessOptions: { example: true } });

const ROOT = "render.fixture.root";
const NOTED = "example.noted";
const leaf = (n: number) => `render.fixture.node.${n}`;

/** Run kb action `id` over the API, and answer its output. */
async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  if (receipt.output === undefined) throw new Error(`${id} answered nothing`);
  return receipt.output;
}

/** A new last child of the fixture root. */
async function add(
  request: APIRequestContext,
  input: { text: string; tags?: string[]; props?: unknown[] },
): Promise<string> {
  return (await invoke<{ id: string }>(request, "node.add", { ...input, parent: ROOT })).id;
}

/** The text of `id`, as the store holds it now. */
async function textOf(request: APIRequestContext, id: string): Promise<string> {
  return (await invoke<{ node: { text: string } }>(request, "node.get", { id })).node.text;
}

/** The note drawn on the row of `row`, for the node `shows`. */
function noteOf(page: Page, row: string, shows = row): Locator {
  return page.locator(
    `[data-node-row="true"][data-node-id="${row}"] [data-example="note"][data-row="${shows}"]`,
  );
}

/**
 * Where `word` is drawn in `note`: a point just inside its first letter's
 * left half, where a press puts the caret before it, and how far below the
 * text's first line it sits.
 */
async function pointAt(
  note: Locator,
  word: string,
): Promise<{ x: number; y: number; below: number; lines: number }> {
  await note.scrollIntoViewIfNeeded();
  return note.evaluate((element, wanted) => {
    const text = element.querySelector(".kb-text");
    if (text === null) throw new Error("the note holds no text");
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(wanted) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      const letter = range.getBoundingClientRect();
      const box = text.getBoundingClientRect();
      const line = Number.parseFloat(getComputedStyle(text).lineHeight);
      return {
        x: letter.left + Math.min(2, letter.width / 4),
        y: letter.top + letter.height / 2,
        below: letter.top - box.top,
        lines: Math.round(box.height / line),
      };
    }
    throw new Error(`the note draws no "${wanted}"`);
  }, word);
}

test.beforeEach(async ({ page }) => {
  // Narrow, so a row's text wraps inside its note.
  await page.setViewportSize({ width: 560, height: 900 });
});

test("a #noted row is drawn as the note, and a press in its wrapped text edits it at that character", async ({
  page,
  request,
}) => {
  const text =
    "A note keeps the row's own text, wrapped inside it at a narrow width, so the word pivot sits on a later line";
  const id = await add(request, { text, tags: [NOTED] });
  await page.goto(`/node/${ROOT}`);
  const note = noteOf(page, id);
  await expect(note).toBeVisible();

  const at = await pointAt(note, "pivot");
  expect(at.lines).toBeGreaterThan(1);
  expect(at.below).toBeGreaterThan(0);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(`[data-node-id="${id}"][data-active="true"]`)).toBeVisible();
  await expect(note).toBeHidden();

  await page.keyboard.type("X");
  await page.keyboard.press("Escape");
  await expect.poll(() => textOf(request, id)).toBe(text.replace("pivot", "Xpivot"));
  await expect(note).toBeVisible();
  await expect(note.locator(".kb-text")).toContainText("Xpivot");
});

test("its inline reference navigates, and a contextual reference is drawn as its note and writes to it", async ({
  page,
  request,
}) => {
  const text = `A note that names [[${leaf(2)}|the second leaf]], and its anchor word`;
  const id = await add(request, { text, tags: [NOTED] });
  const reference = await add(request, {
    text: "",
    props: [{ field: "sys.f.ref.target", value: { t: "ref", v: id } }],
  });
  await page.goto(`/node/${ROOT}`);

  // The reference row shows its target, so it is drawn as the target's note.
  const shown = noteOf(page, reference, id);
  await expect(shown).toBeVisible();
  const at = await pointAt(shown, "anchor");
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(`[data-node-id="${reference}"][data-active="true"]`)).toBeVisible();
  await page.keyboard.type("Y");
  await page.keyboard.press("Escape");
  await expect.poll(() => textOf(request, id)).toBe(text.replace("anchor", "Yanchor"));
  expect(await textOf(request, reference)).toBe("");
  await expect(shown).toBeVisible();

  // A press on the reference inside the note follows it, rather than editing.
  await noteOf(page, id).getByText("the second leaf").click();
  await expect(page).toHaveURL(new RegExp(`/node/${leaf(2).replaceAll(".", "\\.")}$`));
});
