// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A node's display text (DESIGN.md → Display text), walked across the
// surfaces that show it, for texts holding a reference, a bare reference, a
// reference to a deleted node, inline code, a link and a very long title.
// Where a surface has room for a line it draws the rich reading, references
// as pills: the page's title, a row, a References row. Where only a string
// fits it shows the plain reading: the crumb, the tab, Recent, Pinned, ⌘K
// and the Move to… picker. No surface shows the markup.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const LONG =
  "A very long title that keeps going past every column a breadcrumb, a tab, a sidebar row " +
  "or a picker could ever give it, so each of them has to decide where to cut it";

/** Run kb action `id` over the API, and answer its output. */
async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  if (receipt.output === undefined) throw new Error(`${id} answered nothing`);
  return receipt.output;
}

const add = async (request: APIRequestContext, text: string, parent = ROOT): Promise<string> =>
  (await invoke<{ id: string }>(request, "node.add", { text, parent })).id;

const textOf = async (request: APIRequestContext, id: string): Promise<string> =>
  (await invoke<{ node: { text: string } }>(request, "node.get", { id, depth: 0 })).node.text;

/** One probe: a node whose text holds markup, and the words it reads as. */
interface Probe {
  readonly name: string;
  readonly id: string;
  readonly text: string;
  readonly plain: string;
}

/** Rob, a ghost that is deleted, and one probe per kind of markup, each with a child. */
async function seed(request: APIRequestContext) {
  const rob = await add(request, "Rob");
  const ghost = await add(request, "Ghost");
  const texts: ReadonlyArray<readonly [string, string, string]> = [
    ["ref", `Check up with [[${rob}|Rob]]`, "Check up with Rob"],
    ["bare", `Call [[${rob}]] today`, "Call Rob today"],
    ["deleted", `Ask [[${ghost}|Ghost]] and [[${ghost}]]`, `Ask Ghost and ${ghost}`],
    [
      "code",
      "Run `kb docs materialize` and keep snake_case",
      "Run kb docs materialize and keep snake_case",
    ],
    ["link", "Read [the guide](https://example.com/guide) first", "Read the guide first"],
    ["long", LONG, LONG],
  ];
  const probes: Probe[] = [];
  for (const [name, text, plain] of texts) {
    const id = await add(request, text);
    await add(request, "a child", id);
    probes.push({ name, id, text, plain });
  }
  await invoke(request, "node.delete", { id: ghost });
  return { rob, ghost, probes };
}

/** `text` with its runs of whitespace as one space. */
const words = (text: string) => text.replace(/\s+/g, " ").trim();

const title = (page: Page) => page.locator("[data-zoom-title], [data-zoom-title-readonly]");
const row = (page: Page, id: string) =>
  page.locator(`[data-node-row="true"][data-node-id="${id}"]`);

test.beforeEach(async ({ page }) => {
  // Away from the app while the store is seeded, so no page watches the
  // setup and stores an expansion choice for the page the test loads.
  await page.goto("about:blank");
});

test("a node's page draws its title rich, and names it plain in its crumb and the tab", async ({
  page,
  request,
}) => {
  const { probes } = await seed(request);
  for (const probe of probes) {
    await page.goto(`/node/${probe.id}`);
    await expect(title(page)).toBeVisible();
    expect(words(await title(page).innerText()), probe.name).toBe(probe.plain);
    const crumb = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button").last();
    await expect(crumb, probe.name).toHaveText(probe.plain);
    await expect(crumb, probe.name).toHaveAttribute("title", probe.plain);
    await expect(page, probe.name).toHaveTitle(`${probe.plain} — kb`);
  }
  // A reference in the title is the row's pill: its target's ink, followable.
  const [ref] = probes;
  await page.goto(`/node/${ref?.id}`);
  await expect(title(page).locator("a.kb-md-ref")).toHaveText("Rob");
});

test("the title edits as text with its reference intact, and its pill follows", async ({
  page,
  request,
}) => {
  const { rob, probes } = await seed(request);
  const [ref] = probes;
  if (ref === undefined) throw new Error("no probe");
  await page.goto(`/node/${ref.id}`);
  await title(page).getByText("Check up with").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" soon");
  await page.keyboard.press("Enter");
  await expect.poll(() => textOf(request, ref.id)).toBe(`${ref.text} soon`);
  await expect(title(page).locator("a.kb-md-ref")).toHaveText("Rob");

  await title(page).locator("a.kb-md-ref").click();
  await expect(page).toHaveURL(new RegExp(`${rob}$`));
});

test("a row and a References row draw a bare reference by its target's name", async ({
  page,
  request,
}) => {
  const { rob, ghost, probes } = await seed(request);
  const [ref, bare, deleted] = probes;
  await page.goto(`/node/${ROOT}`);
  await expect(
    row(page, bare?.id ?? "")
      .locator("a.kb-md-ref")
      .first(),
  ).toHaveText("Rob");
  // A reference to a deleted node keeps its label; a bare one reads as its id.
  await expect(row(page, deleted?.id ?? "").locator("a.kb-md-ref")).toHaveText(["Ghost", ghost]);

  await page.goto(`/node/${rob}`);
  const references = page.locator(`[data-references-for="${rob}"] [data-node-id]`);
  for (const probe of [ref, bare]) {
    const referrer = references.filter({ hasText: words(probe?.plain ?? "") });
    await expect(referrer.locator("a.kb-md-ref").first()).toHaveText("Rob");
  }
});

test("Recent, Pinned, ⌘K and Move to… name a node by its plain words", async ({
  page,
  request,
}) => {
  const { probes } = await seed(request);
  const [ref] = probes;
  await invoke(request, "node.add", {
    text: "",
    parent: "pinned",
    props: [{ field: "sys.f.ref.target", value: { t: "ref", v: ref?.id } }],
  });
  const recent = page.getByRole("group", { name: "Recent" });
  for (const probe of probes) {
    await page.goto(`/outline/${probe.id}`);
    await expect(recent.getByRole("button").first()).toHaveText(probe.plain);
  }

  await expect(recent.getByRole("button")).toHaveText(probes.toReversed().map((p) => p.plain));
  const pinned = page.getByRole("group", { name: "Pinned" });
  await expect(pinned.getByRole("button", { name: "Check up with Rob" })).toBeVisible();

  await page.goto(`/node/${ROOT}`);
  await expect(row(page, probes[1]?.id ?? "")).toBeVisible();
  await page.getByRole("button", { name: "Open search palette" }).click();
  const palette = page.getByRole("dialog", { name: "Search and open" });
  await expect(palette).toBeVisible();
  for (const probe of probes) {
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(probe.plain.slice(0, 18));
    await expect(palette.getByRole("option").first(), probe.name).toContainText(probe.plain);
  }
  await page.keyboard.press("Escape");

  await row(page, probes[1]?.id ?? "")
    .locator(".node-content")
    .click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("move to");
  await page.keyboard.press("Enter");
  const step = page.getByRole("dialog", { name: "Move to" });
  await page.keyboard.type("Check up");
  await expect(step.getByRole("option").first()).toContainText("Check up with Rob");
  await expect(step).not.toContainText("[[");
});
