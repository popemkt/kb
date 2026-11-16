// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Rows leave kb as text another program reads (DESIGN-UI.md → Outline
// editor, "Copy, cut and Copy as…"), end to end in Chromium: ⌘C on selected
// rows puts Markdown and rich text, and a paste back into kb makes the same
// rows again from kb's own flavour; ⌘⇧C reaches the page and opens Copy as…,
// whose choice is remembered in the graph; a text selection copies its words
// and pastes back as its source, references and all.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";

async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  if (receipt.output === undefined) throw new Error(`${id} answered nothing`);
  return receipt.output;
}

const add = async (request: APIRequestContext, text: string, parent = ROOT): Promise<string> =>
  (await invoke<{ id: string }>(request, "node.add", { text, parent })).id;

interface Held {
  readonly id: string;
  readonly text: string;
  /** Each child pulled one level down: its id among what node.get answers. */
  readonly children: readonly { readonly id: string }[];
  readonly props: Record<string, { t: string; v: unknown }[]>;
}

const stored = async (request: APIRequestContext, id: string): Promise<Held> =>
  (await invoke<{ node: Held }>(request, "node.get", { id })).node;

const row = (page: Page, id: string) =>
  page.locator(`[data-node-row="true"][data-node-id="${id}"]`);

/** Select the rows from `first` down, `extend` siblings below it. */
async function selectDown(page: Page, first: string, extend: number): Promise<void> {
  await row(page, first).locator(".node-content").click();
  await expect(row(page, first)).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Escape");
  await expect(row(page, first)).toHaveAttribute("data-selected", "true");
  for (let i = 0; i < extend; i += 1) await page.keyboard.press("Shift+ArrowDown");
}

/** Edit the row `id`, its caret at the end. */
async function edit(page: Page, id: string): Promise<void> {
  await row(page, id).locator(".node-content").click();
  await expect(row(page, id)).toHaveAttribute("data-active", "true");
}

const clipboardText = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("about:blank");
});

test("⌘C puts selected rows as Markdown, and ⌘V in kb makes them again, tags and all", async ({
  page,
  request,
}) => {
  await invoke(request, "tag.define", { name: "errand", id: "t.errand" });
  const plan = (
    await invoke<{ id: string }>(request, "node.add", {
      text: "Plan the **trip**",
      parent: ROOT,
      tags: ["t.errand"],
    })
  ).id;
  await add(request, "Book the train", plan);
  const second = await add(request, "Pack");
  const target = await add(request, "");
  await page.goto(`/node/${ROOT}`);

  // A range extends over siblings; the child goes with its row.
  await selectDown(page, plan, 1);
  await page.keyboard.press("ControlOrMeta+c");
  await expect
    .poll(() => clipboardText(page))
    .toBe("- Plan the **trip** #errand\n  - Book the train\n- Pack");

  // The copy's own flavour reads back in this store: new rows with the tag, nested.
  await edit(page, target);
  await page.keyboard.press("ControlOrMeta+v");
  const topRows = async () => (await stored(request, ROOT)).children.map(({ id }) => id);
  // The empty row the paste lands on gives its place to the rows made.
  await expect.poll(topRows).not.toContain(target);
  const top = await topRows();
  const [copy, copied] = top.slice(-2);
  const made = await stored(request, copy ?? "");
  expect(made.id).not.toBe(plan);
  expect(made.text).toBe("Plan the **trip**");
  expect(made.props["sys.f.type"]).toEqual([{ t: "ref", v: "t.errand" }]);
  expect(made.children).toHaveLength(1);
  expect((await stored(request, copied ?? "")).text).toBe("Pack");
  expect(second).not.toBe(copied);
});

test("⌘⇧C reaches the page and opens Copy as…, whose choice is the graph's", async ({
  page,
  request,
}) => {
  const plan = await add(request, "Plan the trip");
  await add(request, "Book the train", plan);
  await page.goto(`/node/${ROOT}`);

  await selectDown(page, plan, 0);
  await page.keyboard.press("ControlOrMeta+Shift+c");
  const dialog = page.getByRole("dialog", { name: "Copy as…" });
  await expect(dialog).toBeVisible();
  // Rich text previews as drawn, in a frame no script runs in.
  await dialog.getByRole("radio", { name: /^Rich text/ }).click();
  await expect(
    page.frameLocator('[data-testid="copy-as-preview"]').locator("li li").first(),
  ).toHaveText("Book the train");
  await dialog.getByRole("radio", { name: /Tana Paste/ }).click();
  await expect(dialog.getByTestId("copy-as-preview")).toHaveText(
    "%%tana%%\n- Plan the trip\n  - Book the train",
  );
  await dialog.getByRole("radio", { name: "A tab" }).click();
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => clipboardText(page))
    .toBe("%%tana%%\n- Plan the trip\n\t- Book the train");

  const family = await stored(request, "sys.extension.outline");
  expect(family.props["sys.f.outline.copy.format"]).toEqual([
    { t: "ref", v: "sys.outline.copy.format.tana" },
  ]);
  expect(family.props["sys.f.outline.copy.indent"]).toEqual([
    { t: "ref", v: "sys.outline.copy.indent.tabs" },
  ]);

  // It opens on what was chosen.
  await row(page, plan).locator(".node-content").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+Shift+c");
  await expect(dialog.getByRole("radio", { name: /Tana Paste/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("a text selection copies its words, and pastes back in kb as its source", async ({
  page,
  request,
}) => {
  const ada = await add(request, "Ada Lovelace");
  const source = await add(request, `Ask [[${ada}]] about it`);
  const target = await add(request, "Then ");
  await page.goto(`/node/${ROOT}`);

  await edit(page, source);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => clipboardText(page)).toBe("Ask Ada Lovelace about it");

  await edit(page, target);
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+v");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await stored(request, target)).text)
    .toBe(`Then Ask [[${ada}]] about it`);
});
