// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Triggers in the text (DESIGN-UI.md → Triggers in the text), end to end in
// a browser: `#` tags the row it is typed in, `>` on an empty row adds a
// field and puts the caret in its value, and `@` offers the date its query
// names first, with days on, and references that day.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";

/** Run kb action `id` over the API, and answer its output. */
async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output as T;
}

const ref = (v: string) => ({ t: "ref", v });

interface Held {
  readonly text: string;
  readonly props: Record<string, { v: unknown }[]>;
}

/** The node `id` as the store holds it. */
const held = async (request: APIRequestContext, id: string): Promise<Held> =>
  (await invoke<{ node: Held }>(request, "node.get", { id })).node;

/** Add a row under the fixture's root, and start editing it at its end. */
async function editRow(page: Page, request: APIRequestContext, text: string): Promise<string> {
  const { id } = await invoke<{ id: string }>(request, "node.add", { text, parent: ROOT });
  await page.goto(`/node/${ROOT}`);
  const row = page.locator(`[data-node-row="true"][data-node-id="${id}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.locator(".node-content").click();
  await expect(row).toHaveAttribute("data-active", "true");
  await page.keyboard.press("End");
  return id;
}

const picker = (page: Page) => page.getByRole("listbox");

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("# offers the tags, and a pick takes it out of the text and tags the row", async ({
  page,
  request,
}) => {
  await invoke(request, "node.add", {
    id: "tr.t.reading",
    text: "reading",
    parent: ROOT,
    props: [{ field: "sys.f.type", value: ref("sys.tag") }],
  });
  const id = await editRow(page, request, "A book to finish");
  await page.keyboard.type(" #read");
  await expect(picker(page).getByRole("option").first()).toContainText("reading");
  await page.keyboard.press("Enter");
  await expect(picker(page)).toBeHidden();
  await expect
    .poll(async () => (await held(request, id)).props["sys.f.type"]?.map((v) => v.v))
    .toContain("tr.t.reading");
  expect((await held(request, id)).text).toBe("A book to finish ");

  // `#` inside a word is text: no picker opens.
  await page.keyboard.type("in C#");
  await expect(picker(page)).toBeHidden();
});

test("> on an empty row adds the field picked, and the caret goes into its value", async ({
  page,
  request,
}) => {
  await invoke(request, "node.add", {
    id: "tr.f.effort",
    text: "effort",
    parent: ROOT,
    props: [{ field: "sys.f.type", value: ref("sys.field") }],
  });
  const id = await editRow(page, request, "");
  await page.keyboard.type(">effo");
  await expect(picker(page).getByRole("option").first()).toContainText("effort");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await held(request, id)).text).toBe("");
  const row = page.locator(`[data-node-block][data-node-id="${id}"]`).first();
  await expect(row.locator("[data-value-slot]")).toHaveCount(1);
  await expect(row.locator("[data-value-slot]:focus, [data-value-slot] :focus")).toHaveCount(1);
});

test("@ with days on offers the date first, and a pick references its day", async ({
  page,
  request,
}) => {
  await invoke(request, "extension.switch", { name: "days", on: true });
  const id = await editRow(page, request, "Due");
  await page.keyboard.type(" @tomorrow");
  await expect(picker(page).getByRole("option").first()).toContainText("Tomorrow");
  await page.keyboard.press("Enter");
  await expect(picker(page)).toBeHidden();

  // The day the pick made is the one days answers for tomorrow, made once.
  const tomorrow = await page.evaluate(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toLocaleDateString(
      "en-CA",
    );
  });
  const day = await invoke<{ id: string; made: string[] }>(request, "ext.days.today", {
    day: tomorrow,
  });
  expect(day.made).toEqual([]);
  await expect
    .poll(async () => (await held(request, id)).text)
    .toMatch(new RegExp(`^Due \\[\\[${day.id}\\|`, "u"));
});
