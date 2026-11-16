// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A row emptied and typed again stores only what was typed (DESIGN-UI.md →
// Outline editor, "Node text is one surface, read or edited"). Backspacing a
// row's last character, or selecting it all and deleting, leaves the
// browser's placeholder `<br>` in the editor, and typing goes in front of it.
// That break ends the text, so it reads as nothing: no trailing newline is
// stored, and Enter at the end carries none into the row it opens.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";

async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output as T;
}

const add = async (request: APIRequestContext, text: string): Promise<string> =>
  (await invoke<{ id: string }>(request, "node.add", { text, parent: ROOT })).id;

/** The texts of the root's children from `from` on, as stored. */
async function textsFrom(request: APIRequestContext, from: string): Promise<string[]> {
  const root = await invoke<{ node: { children: Array<{ id: string; text: string }> } }>(
    request,
    "node.get",
    { id: ROOT, depth: 1 },
  );
  const children = root.node.children;
  return children.slice(children.findIndex((c) => c.id === from)).map((c) => c.text);
}

const row = (page: Page, id: string) =>
  page.locator(`[data-node-row="true"][data-node-id="${id}"]`);

async function editAtEnd(page: Page, id: string): Promise<void> {
  await row(page, id).locator(".node-content").click();
  await page.keyboard.press("End");
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("a row backspaced empty and typed again stores no newline, nor does the row Enter opens", async ({
  page,
  request,
}) => {
  const id = await add(request, "z");
  await page.goto(`/node/${ROOT}`);
  await editAtEnd(page, id);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("bb");
  await page.keyboard.press("Enter");
  await page.keyboard.type("cc");
  await expect.poll(() => textsFrom(request, id)).toEqual(["bb", "cc"]);
});

test("a row selected whole and deleted, then typed, stores only the typing", async ({
  page,
  request,
}) => {
  const id = await add(request, "abc");
  await page.goto(`/node/${ROOT}`);
  await editAtEnd(page, id);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("xy");
  await expect.poll(() => textsFrom(request, id)).toEqual(["xy"]);
});

test("an IME composition in an emptied row stores the word it commits, and nothing more", async ({
  page,
  request,
}) => {
  const id = await add(request, "z");
  await page.goto(`/node/${ROOT}`);
  await editAtEnd(page, id);
  await page.keyboard.press("Backspace");
  // Telex: "tieesng" composes to "tiếng", committed by the IME.
  const cdp = await page.context().newCDPSession(page);
  for (const text of ["t", "ti", "tiê", "tiếng"]) {
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
  }
  await cdp.send("Input.insertText", { text: "tiếng" });
  await expect.poll(() => textsFrom(request, id)).toEqual(["tiếng"]);
});

test("Enter that commits an IME word, sent after the composition ends as WebKit does, splits no row", async ({
  page,
  request,
}) => {
  const id = await add(request, "Tiếng");
  await add(request, "next");
  await page.goto(`/node/${ROOT}`);
  await editAtEnd(page, id);
  const cdp = await page.context().newCDPSession(page);
  for (const text of [" V", " Vi", " Việt"]) {
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
  }
  // The IME commits the word (compositionend), then WebKit sends the Enter
  // that committed it, with keyCode 229.
  await cdp.send("Input.insertText", { text: " Việt" });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 229,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 229,
  });
  // What is typed next lands in the row that has the caret: a split would
  // leave it in a new, empty row.
  await page.keyboard.type("!");
  await expect.poll(() => textsFrom(request, id)).toEqual(["Tiếng Việt!", "next"]);
});
