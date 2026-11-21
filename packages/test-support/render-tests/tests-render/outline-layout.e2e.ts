// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Layout the unit suite cannot see: whether something painted outside its box
// makes the page scroll sideways, and whether an absolutely placed badge is
// clipped. Only a real engine measuring real boxes can answer either.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

// Each child count is drawn only when the outline's setting asks for it
// (DESIGN-UI.md → "A collapsed parent's halo says it is closed; its count is
// a setting"), so every page here shows them.
test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/action", {
    data: {
      id: "node.update",
      input: {
        id: "sys.extension.outline",
        setProps: [{ field: "sys.f.outline.child-counts", value: { t: "bool", v: true } }],
      },
    },
  });
  expect((await response.json()).status).toBe("succeeded");
});

async function home(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-bullet-count]").first()).toBeVisible();
}

/** The main region's own sideways overflow, and each count badge's box against it. */
function measure(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("[data-main-region]");
    if (!(main instanceof HTMLElement)) return null;
    const frame = main.getBoundingClientRect();
    const badges = [...document.querySelectorAll("[data-bullet-count]")].map((el) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, right: box.right, text: el.textContent };
    });
    return {
      overflow: main.scrollWidth - main.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      frameLeft: frame.left,
      badges,
    };
  });
}

type Measure = NonNullable<Awaited<ReturnType<typeof measure>>>;

/**
 * The layout once it has stopped moving: two measurements in a row that
 * agree, with at least one count badge laid out. Rows mount and fonts swap
 * after the first badge is visible, so the first sample that happens to pass
 * can still be a frame in motion; the assertions run once, on this one.
 */
async function settled(page: Page): Promise<Measure> {
  const last: { m: Measure | null; key: string } = { m: null, key: "" };
  await expect
    .poll(
      async () => {
        const m = await measure(page);
        const key = JSON.stringify(m);
        const still = m !== null && m.badges.length > 0 && key === last.key;
        last.m = m;
        last.key = key;
        return still;
      },
      { intervals: [100, 250] },
    )
    .toBe(true);
  if (last.m === null) throw new Error("no main region");
  return last.m;
}

for (const width of [1280, 390]) {
  test(`home at ${width}px never scrolls sideways, and its header wash stays inside`, async ({
    page,
  }) => {
    await home(page, width);
    await expect(page.locator("[data-header-wash]")).toHaveCount(1);
    const m = await settled(page);
    expect(m.overflow).toBe(0);
    expect(m.pageOverflow).toBe(0);
  });

  test(`home at ${width}px shows every child count whole`, async ({ page }) => {
    await home(page, width);
    const m = await settled(page);
    for (const badge of m.badges) {
      expect(badge.left, `count ${badge.text}`).toBeGreaterThanOrEqual(m.frameLeft);
    }
  });
}

const LONG_TITLE =
  "A page title long enough that no page is wide enough to hold it on one line, ".repeat(2);

/** The page heading's box against its text: overflow it hides, and how many lines it takes. */
function titleBox(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const box = el.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
    return {
      hidden: el.scrollWidth - el.clientWidth,
      lines: Math.round((box.height - 8) / lineHeight),
      height: box.height,
      text: el.textContent,
    };
  });
}

for (const width of [1280, 390]) {
  test(`a long page title at ${width}px wraps whole, and keeps its shape while edited`, async ({
    page,
    request,
  }) => {
    const response = await request.post("/api/action", {
      data: { id: "node.add", input: { id: "layout.long", text: LONG_TITLE.trim(), position: 0 } },
    });
    expect((await response.json()).status).toBe("succeeded");
    await home(page, width);
    await page
      .locator('[data-node-id="layout.long"] button.bullet-container')
      .first()
      .click({ modifiers: ["ControlOrMeta"] });

    const view = await titleBox(page, "[data-zoom-title]");
    expect(view.text).toBe(LONG_TITLE.trim());
    expect(view.hidden).toBe(0);
    expect(view.lines).toBeGreaterThan(1);

    await page.locator("[data-zoom-title]").click();
    const edit = await titleBox(page, "[data-zoom-title-editor]");
    expect(edit.hidden).toBe(0);
    expect(edit.height).toBe(view.height);

    const m = await measure(page);
    expect(m?.overflow).toBe(0);
  });
}

/** The control's line, the open bar, its frame's line, the head and the page's first row. */
const rects = (page: Page) =>
  page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- page.evaluate serializes this callback, so its helpers live inside it
    const box = (selector: string) => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      return r === undefined ? null : { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      control: box("[data-view-control]"),
      bar: box("[data-view-toolbar]"),
      // The open bar, or the frame its gear stands in: their line, not their width.
      frame: (() => {
        const frame =
          document.querySelector("[data-view-toolbar]") ??
          document.querySelector("[data-view-toolbar-gear]")?.parentElement;
        const r = frame?.getBoundingClientRect();
        return r === undefined ? null : { y: r.y, height: r.height };
      })(),
      head: box("[data-zoomed-root-header]"),
      row: box('[data-node-row="true"]'),
    };
  });

// The view control's line under the title (DESIGN-UI.md → The page's title):
// opening it, hovering it, choosing a view and closing it move nothing, not
// the bar's line, not the head, not the row under it.
test.describe("the view control holds still", () => {
  async function seedPage(request: APIRequestContext): Promise<string> {
    const add = async (text: string, parent: string) =>
      (await invokeGrid<{ id: string }>(request, "node.add", { text, parent })).id;
    const id = await add("A page with a view control", "render.fixture.root");
    await add("Its first row", id);
    await add("Its second row", id);
    return id;
  }

  test("on a list page, through its gear, its views and its close", async ({ page, request }) => {
    await page.goto(`/node/${await seedPage(request)}`);
    await expect(page.locator("[data-view-toolbar-gear]")).toHaveCount(1);
    await page.mouse.move(0, 0);
    const rest = await rects(page);
    const still = async (state: string) => {
      const now = await rects(page);
      expect(now.control, `${state}: the control's line`).toEqual(rest.control);
      expect(now.frame, `${state}: the bar's frame`).toEqual(rest.frame);
      expect(now.head, `${state}: the head`).toEqual(rest.head);
      expect(now.row, `${state}: the row under it`).toEqual(rest.row);
    };
    await page.locator("[data-zoom-title]").hover();
    await still("the head hovered");
    await page.locator("[data-view-toolbar-gear]").click();
    await expect(page.locator("[data-view-toolbar]")).toBeVisible();
    await still("the gear opened");
    for (const mode of await page
      .locator("[data-mode-button]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-mode-button")))) {
      await page.locator(`[data-mode-button="${mode}"]`).hover();
      await still(`${mode} hovered`);
    }
    await page.locator('[aria-label="Collapse view options"]').click();
    await expect(page.locator("[data-view-toolbar-gear]")).toHaveCount(1);
    await page.mouse.move(0, 0);
    await still("closed with ×");
  });

  test("on a page shown as a view, choosing each view", async ({ page, request }) => {
    await page.goto(`/node/${await seedPage(request)}`);
    await page.locator("[data-view-toolbar-gear]").click();
    await page.locator('[data-mode-button="table"]').click();
    await expect(page.locator('[data-view-toolbar][data-active-mode="table"]')).toBeVisible();
    await page.mouse.move(0, 0);
    const first = await rects(page);
    const modes = await page
      .locator("[data-mode-button]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-mode-button")));
    for (const mode of [...modes.filter((m) => m !== "list" && m !== "table"), "table"]) {
      await page.locator(`[data-mode-button="${mode}"]`).click();
      await expect(page.locator(`[data-view-toolbar][data-active-mode="${mode}"]`)).toBeVisible();
      await page.mouse.move(0, 0);
      const now = await rects(page);
      expect(now.bar, `${mode} chosen: the bar`).toEqual(first.bar);
      expect(now.head, `${mode} chosen: the head`).toEqual(first.head);
      await page.locator(`[data-mode-button="${mode}"]`).hover();
      expect((await rects(page)).bar, `${mode} hovered: the bar`).toEqual(first.bar);
    }
  });
});

// The outline grid (DESIGN-UI.md → Outline layout), walked over a page that
// holds every line kind: rows, a row with a box, field rows of every type
// with their values, hidden and tucked chips, ghost rows, a query's results,
// an event's line, references, and the page's own title, tags, view control
// and fields. Every glyph must centre on its depth's glyph column and every
// first letter must start on its depth's text column; a drift fails with a
// table of what moved and by how much.
test.describe("the outline grid", () => {
  // Served by `kb ui`, so the routines family is there to draw an event's line.
  test.use({ harnessOptions: { hosted: true } });

  for (const width of [1280, 360]) {
    test(`every line kind stands on the grid at ${width}px`, async ({ page, request }) => {
      const pageId = await seedGrid(request);
      await page.setViewportSize({ width, height: 1600 });
      await page.goto(`/node/${pageId}`);
      await expect(page.locator("[data-zoom-title]")).toBeVisible();
      for (const text of ["A parent row, open", "Its child", "A row with every field type"]) {
        await openRow(page, text);
      }
      await expect(page.locator("[data-event-line]")).toBeVisible();
      await expect(page.locator("[data-references-for]")).toBeVisible();
      // References open from their one closed line; their places and rows are lines too.
      await page.locator("[data-references-for] h2 button").first().click();
      await expect(page.locator("[data-references-for] [data-node-row]").first()).toBeVisible();
      await page.mouse.move(0, 0);
      const drift = await gridDrift(page);
      expect(drift.checked, "the walk found the line kinds").toBeGreaterThan(60);
      expect(drift.off, `lines off the grid:\n${drift.off.join("\n")}`).toEqual([]);
    });
  }
});

type ApiValue = { t: string; v: unknown };
const ref = (v: string): ApiValue => ({ t: "ref", v });
const str = (v: string): ApiValue => ({ t: "str", v });
const num = (v: number): ApiValue => ({ t: "num", v });

/** Run kb action `id` over the API: its output. */
async function invokeGrid<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, `${id}: ${receipt.message}`).toBe("succeeded");
  return receipt.output as T;
}

/** The page, its rows of every kind, and what they need. */
async function seedGrid(request: APIRequestContext): Promise<string> {
  const add = async (text: string, parent: string, props: Record<string, ApiValue[]> = {}) =>
    (
      await invokeGrid<{ id: string }>(request, "node.add", {
        text,
        parent,
        props: Object.entries(props).flatMap(([field, values]) =>
          values.map((value) => ({ field, value })),
        ),
      })
    ).id;
  const ROOT = "render.fixture.root";
  const TYPE = "sys.f.type";
  const field = (text: string, type: string, show?: string) =>
    add(text, ROOT, {
      [TYPE]: [ref("sys.field")],
      "sys.f.fieldType": [ref(`sys.ft.${type}`)],
      ...(show === undefined ? {} : { "sys.f.show": [ref(`sys.show.${show}`)] }),
    });
  const f = {
    text: await field("Text", "text"),
    number: await field("Number", "number"),
    date: await field("Date", "date"),
    url: await field("URL", "url"),
    checkbox: await field("Checkbox", "checkbox"),
    ref: await field("Ref", "ref"),
    time: await field("Time", "time"),
    hidden: await field("A hidden field", "text", "hidden"),
    tucked: await field("A tucked field", "text", "tucked"),
  };
  const probe = await add("probe", ROOT, {
    [TYPE]: [ref("sys.tag")],
    "sys.f.fields": Object.values(f).map(ref),
  });
  const done = await field("Done", "checkbox");
  const chore = await add("chore", ROOT, {
    [TYPE]: [ref("sys.tag")],
    "sys.f.fields": [ref(done)],
    "sys.f.tag.check": [ref(done)],
  });
  const ada = await add("Ada", ROOT);
  const linus = await add("Linus", ROOT);

  const grid = await add("The outline grid", ROOT, {
    [TYPE]: [ref(probe)],
    [f.text]: [str("a value")],
  });
  await add("A plain row", grid);
  const open = await add("A parent row, open", grid);
  await add("A grandchild", await add("Its child", open));
  await add("Hidden child", await add("A collapsed parent", grid));
  await add("A row with a box", grid, { [TYPE]: [ref(chore)] });
  await add("A row with every field type", grid, {
    [TYPE]: [ref(probe)],
    [f.text]: [str("plain words")],
    [f.number]: [num(42)],
    [f.date]: [str("2026-11-20")],
    [f.url]: [str("https://example.com/a/long/link")],
    [f.checkbox]: [{ t: "bool", v: true }],
    [f.ref]: [ref(ada), ref(linus)],
    [f.time]: [str("08:30")],
  });
  await add(`[[${ada}]]`, grid);
  await add("https://example.com/a/bare/url", grid);
  await add(
    "Read [the guide](https://example.com/guide), `code` and [[" + linus + "|a ref]]",
    grid,
  );
  await add(
    "A very long row that wraps onto a second line because it keeps on going past the width " +
      "any pane gives one line of outline text, so its second line starts where its first does",
    grid,
  );
  await add("Every chore", grid, {
    "sys.f.query": [
      str(
        `[:find ?id ?text :where [?n :f/sys.f.type ?t] [?t :node/id "${chore}"] [?n :node/id ?id] [?n :node/text ?text]]`,
      ),
    ],
  });
  await invokeGrid(request, "extension.switch", { name: "routines", on: true });
  await invokeGrid(request, "node.update", {
    id: "sys.extension.routines",
    setProps: [
      {
        field: "sys.f.display.routines.event.preview",
        value: ref("sys.f.display.routines.event.preview.always"),
      },
    ],
  });
  const calendar = await add("Personal", grid, {
    [TYPE]: [ref("sys.tag.calendar")],
    "sys.f.routines.sync": [ref("sys.f.routines.sync.preview")],
  });
  await add("Gym", grid, {
    [TYPE]: [ref("sys.tag.routine")],
    "sys.f.routines.calendar": [ref(calendar)],
    "sys.f.routines.starts": [str("2026-11-01")],
    "sys.f.routines.at": [str("07:00")],
    "sys.f.routines.duration": [num(60)],
    "sys.f.routines.rrule": [str("FREQ=DAILY")],
  });
  await add(`See [[${grid}|the grid]]`, ROOT);
  return grid;
}

/** Open the row that says `text`, when it is closed (its bullet wears the closed halo). */
async function openRow(page: Page, text: string) {
  const row = page.locator('[data-node-row="true"]').filter({ hasText: text }).first();
  await expect(row).toBeVisible();
  if ((await row.locator("[data-bullet-halo]").count()) > 0) {
    await row.locator("button.bullet-container").first().click();
  }
  await expect(row.locator("[data-bullet-halo]")).toHaveCount(0);
}

/**
 * Every line on the page against the grid: its glyph's centre and its first
 * letter's start, each against where its depth puts them, measured from the
 * page head's left edge (the outline's origin) with the grid's own tokens.
 */
function gridDrift(page: Page) {
  return page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- page.evaluate serializes this callback, so its helpers live inside it
    const px = (token: string) => {
      const probe = document.createElement("div");
      probe.style.width = `var(${token})`;
      document.body.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    };
    const step = px("--kb-indent");
    const rowH = px("--kb-row-h");
    const glyph = px("--kb-glyph");
    const inset = px("--kb-text-inset");
    const head = document.querySelector("[data-zoomed-root-header]");
    if (!(head instanceof HTMLElement)) throw new Error("no page head");
    const headBox = head.getBoundingClientRect();
    const origin = headBox.left;
    const glyphAt = (d: number) => origin + d * step + glyph / 2;
    const textAt = (d: number) => origin + d * step + glyph + inset;
    const depthOf = (el: Element) => Math.round((el.getBoundingClientRect().left - origin) / step);
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- page.evaluate serializes this callback, so its helpers live inside it
    const centre = (el: Element | null) => {
      if (el === null) return null;
      const box = el.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };
    /** The box of the first letter drawn in `root`. */
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- page.evaluate serializes this callback, so its helpers live inside it
    const firstLetter = (root: Element | null) => {
      if (root === null) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          const el = n.parentElement;
          if ((n.textContent ?? "").trim() === "" || el === null) return NodeFilter.FILTER_REJECT;
          // A row's own words: not its glyph, its count, or the chips it ends in.
          if (
            el.closest(
              '[aria-hidden="true"], [data-bullet-count], .bullet-container, svg, [data-tag-chip-group]',
            )
          )
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const node = walker.nextNode();
      if (node === null) return null;
      const at = (node.textContent ?? "").search(/\S/);
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      return range.getClientRects()[0] ?? null;
    };
    const off: string[] = [];
    let checked = 0;
    const near = (what: string, want: number, got: number | null | undefined) => {
      checked += 1;
      if (got === null || got === undefined) off.push(`${what}: not drawn`);
      else if (Math.abs(want - got) > 0.5)
        off.push(
          `${what}: ${Math.round(got - origin)} from the origin, wants ${Math.round(want - origin)}`,
        );
    };
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- page.evaluate serializes this callback, so its helpers live inside it
    const words = (el: Element) => el.textContent.trim().slice(0, 32);

    // The page's head: its title, tags and view control on the text column,
    // the title owning its whole line.
    const checkHead = () => {
      const title = head.querySelector("[data-zoom-title]");
      near("title", textAt(0), firstLetter(title)?.left);
      near("title's line end", headBox.right, title?.getBoundingClientRect().right);
      near(
        "title's tags",
        textAt(0),
        head.querySelector("[data-tag-chip]")?.getBoundingClientRect().left,
      );
      const control = head.querySelector("[data-view-control]");
      near("view control", textAt(0), control?.getBoundingClientRect().left);
      const titleBottom = title?.getBoundingClientRect().bottom ?? 0;
      if ((control?.getBoundingClientRect().top ?? 0) < titleBottom)
        off.push("view control: beside the title");
    };

    // Rows: the bullet on the glyph column, a box one step in, the text after.
    const checkRows = () => {
      for (const row of document.querySelectorAll('[data-node-row="true"]')) {
        const d = depthOf(row);
        const what = `row "${words(row)}"`;
        const valueColumn = row.closest("[data-field-value-column]");
        if (valueColumn !== null) continue; // a value's row: below
        const bullet = centre(row.querySelector(".bullet-container"));
        near(`${what} bullet`, glyphAt(d), bullet?.x);
        const box = row.querySelector("[data-row-check]");
        if (box !== null) near(`${what} box`, glyphAt(d + 1), centre(box)?.x);
        const letter = firstLetter(row.querySelector(".node-content"));
        near(`${what} text`, textAt(box === null ? d : d + 1), letter?.left);
        // One line of text is one row tall.
        const content = row.querySelector(".node-content")?.getBoundingClientRect();
        if (content !== undefined && content.height <= rowH + 0.5)
          near(`${what} height`, rowH, row.getBoundingClientRect().height);
        // The bullet is level with the first line of the text.
        if (
          bullet !== null &&
          letter !== null &&
          Math.abs(bullet.y - (letter.top + letter.height / 2)) > 2
        )
          off.push(
            `${what}: bullet ${Math.round(bullet.y - letter.top - letter.height / 2)}px off its first line`,
          );
      }
    };

    // Field rows: the type glyph on the glyph column, the name on the text
    // column, and every value of one depth on one value column, a
    // reference's bullet hung before it.
    const checkFields = () => {
      const valueAt = new Map<number, number>();
      for (const row of document.querySelectorAll(
        '[data-field-row="true"]:not([data-field-value-only])',
      )) {
        const d = depthOf(row);
        const what = `field "${words(row.querySelector("[data-field-name]") ?? row)}"`;
        near(`${what} glyph`, glyphAt(d), centre(row.firstElementChild)?.x);
        near(`${what} name`, textAt(d), firstLetter(row.querySelector("[data-field-name]"))?.left);
        const value = row.querySelector("[data-field-value-column]");
        // One line of value is a row, 4px above and below, inside its hairlines.
        if ((value?.getBoundingClientRect().height ?? 0) <= rowH + 0.5)
          near(`${what} height`, rowH + 2 * 4 + 2, row.getBoundingClientRect().height);
        const letter = firstLetter(value);
        if (letter === null) continue;
        const column = valueAt.get(d) ?? letter.left;
        valueAt.set(d, column);
        near(`${what} value`, column, letter.left);
        const refRow = value?.querySelector('[data-node-row="true"]');
        if (refRow)
          near(
            `${what} value's bullet`,
            column - inset - glyph / 2,
            centre(refRow.querySelector(".bullet-container"))?.x,
          );
      }
    };

    // Ghost rows, chips lines, line previews and headings, each on the columns.
    const checkOthers = () => {
      // Ghost rows: the ghost glyph and its placeholder, together, on the columns.
      for (const ghost of document.querySelectorAll('[data-ghost-row="true"]')) {
        const d = depthOf(ghost);
        near(`ghost row (depth ${d}) glyph`, glyphAt(d), centre(ghost.querySelector("svg"))?.x);
        near(`ghost row (depth ${d}) placeholder`, textAt(d), firstLetter(ghost)?.left);
        near(`ghost row (depth ${d}) height`, rowH, ghost.getBoundingClientRect().height);
      }

      // A hidden fields line: its first chip's glyph and name, as a field row's.
      for (const line of document.querySelectorAll("[data-hidden-fields]")) {
        const d = depthOf(line);
        near(`chips (depth ${d}) glyph`, glyphAt(d), centre(line.querySelector("svg"))?.x);
        near(`chips (depth ${d}) name`, textAt(d), firstLetter(line)?.left);
      }

      // A row's line preview (an event's) starts on the child's text column.
      for (const preview of document.querySelectorAll(
        '[data-row-preview][data-preview-kind="live"]',
      )) {
        const d = depthOf(preview);
        // A part's own separator hangs before it; its first mark is where it starts.
        const part = preview.querySelector("[data-event-line-part] > *");
        near(`event line (depth ${d})`, textAt(d), part?.getBoundingClientRect().left);
      }

      // A section's heading starts on the text column.
      for (const heading of document.querySelectorAll(
        "[data-references-for] h2, [data-node-section] h2",
      )) {
        near(`heading "${words(heading)}"`, textAt(0), firstLetter(heading)?.left);
      }
    };

    checkHead();
    checkRows();
    checkFields();
    checkOthers();
    return { off, checked };
  });
}
