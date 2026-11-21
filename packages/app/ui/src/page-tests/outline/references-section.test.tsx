import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bundledSeed } from "@kb/bundled";
import type { WireNode } from "@kb/contracts";
import { isQueryNode, present, SYSTEM_IDS } from "@kb/model";
import { OutlineEditor, outlineNodes } from "@kb/outline-ui";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { childInstanceKey, projectedRowKey, syncUiPlugins } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

const ISO = "2026-08-08T05:00:00.000Z";
const TARGET = "n.spec";
const PLAIN = "we should write spec soon";

function wire(id: string, text: string, children: string[] = []): WireNode {
  return { id, text, props: {}, children, createdAt: ISO, updatedAt: ISO };
}

function graph(extra: WireNode[]) {
  const relation = wire("f.influences", "influences");
  relation.props[SYSTEM_IDS.typeField] = [{ t: "ref", v: SYSTEM_IDS.field }];
  relation.props[SYSTEM_IDS.relationInverseField] = [{ t: "str", v: "influenced by" }];
  const followUp = wire("n.follow-up", "Follow up after [[n.spec|Write spec]]");
  followUp.props[relation.id] = [{ t: "ref", v: TARGET }];
  return [
    ...bundledSeed(ISO).filter((node) => !isQueryNode(node)),
    wire(TARGET, "Write spec"),
    wire("n.project", "Project notes", ["n.decision", "n.follow-up"]),
    wire("n.decision", "Decision [[n.spec|Write spec]]", ["n.criteria"]),
    wire("n.criteria", "Acceptance criteria"),
    followUp,
    relation,
    wire("n.plain", PLAIN),
    ...extra,
  ];
}

/** How many referrers a place shows. */
const shownIn = (place: Element) => place.querySelectorAll("[data-backlink-id]").length;

const settled = async (assertion: () => void) => {
  await vi.waitFor(async () => {
    await act(async () => {});
    assertion();
  });
};

describe("node page references", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    syncPagePlugins([outlineUiPlugin]);
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
    syncUiPlugins([]);
  });

  beforeEach(() => {
    resetOutlineStore();
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function draw(nodeId?: string, extra: WireNode[] = []) {
    await act(async () => {
      useGraphStore.getState().hydrateFromWire(graph(extra), 1, "fixtures");
      if (nodeId !== undefined) useGraphStore.getState().zoomTo(nodeId);
      root.render(<OutlineEditor />);
    });
  }

  const find = (selector: string) => container.querySelector<HTMLElement>(selector);
  const count = (selector: string) => container.querySelectorAll(selector).length;
  const headings = () => [
    ...container.querySelectorAll<HTMLButtonElement>("[data-references-for] h2 button"),
  ];
  const heading = (name: string) =>
    present(
      headings().find((button) => button.textContent.startsWith(name)),
      `${name} heading`,
    );
  /** Open References, and Unlinked mentions under it when `mentions`. */
  async function openReferences(mentions = false) {
    await settled(() => expect(headings()).not.toHaveLength(0));
    await act(async () => heading("References").click());
    if (mentions) await act(async () => heading("Unlinked mentions").click());
  }
  const bulletOf = (row: string) =>
    present(find(`${row} [data-node-row] [data-bullet-kind]`), `${row} bullet`);
  const showMore = (label: string) =>
    present(
      [...container.querySelectorAll<HTMLElement>("[data-show-more]")].find((button) =>
        button.textContent.startsWith(label),
      ),
      label,
    );

  it("is one closed line that says how many, until it is opened", async () => {
    await draw(TARGET);
    await settled(() =>
      expect(heading("References").textContent).toBe("References(2 · 1 unlinked)"),
    );
    expect(heading("References").getAttribute("aria-expanded")).toBe("false");
    expect(count("[data-backlink-id]")).toBe(0);
    expect(count("[data-unlinked-mention-id]")).toBe(0);

    await openReferences();
    expect(heading("References").getAttribute("aria-expanded")).toBe("true");
    expect(count("[data-backlink-id]")).toBe(2);
    // The unlinked mentions wait behind their own line.
    expect(heading("Unlinked mentions").getAttribute("aria-expanded")).toBe("false");
    expect(count("[data-unlinked-mention-id]")).toBe(0);
  });

  it("names the place the referrers are written in once, and folds a referrer's children by its bullet", async () => {
    await draw(TARGET);
    await openReferences();
    // Both referrers are children of Project notes: one place, drawn as its row.
    const place = present(find('[data-reference-place="n.project"]'), "place");
    expect(place.querySelector("[data-node-row]")?.textContent).toBe("Project notes");
    expect(
      [...place.querySelectorAll("[data-backlink-id]")].map((row) =>
        row.getAttribute("data-backlink-id"),
      ),
    ).toEqual(["n.decision", "n.follow-up"]);
    expect(find('[data-backlink-relation="f.influences"]')?.textContent).toBe("influenced by");

    expect(find('[data-backlink-id] [data-node-block][data-node-id="n.criteria"]')).toBeNull();
    await act(async () => bulletOf('[data-backlink-id="n.decision"]').click());
    const child = find('[data-backlink-id] [data-node-block][data-node-id="n.criteria"]');
    expect(child?.textContent).toContain("Acceptance criteria");
    expect(child?.dataset.instanceKey).not.toBe(
      childInstanceKey(projectedRowKey(TARGET, "n.decision"), "n.criteria"),
    );

    // The place's own bullet folds the place.
    await act(async () => bulletOf('[data-reference-place="n.project"] >').click());
    expect(count("[data-backlink-id]")).toBe(0);
  });

  it("folds by bullets that Tab reaches and that say whether they are open", async () => {
    await draw(TARGET);
    await openReferences();
    const referrer = bulletOf('[data-backlink-id="n.decision"]');
    const place = bulletOf('[data-reference-place="n.project"] >');
    // A row that holds nothing to fold keeps its bullet out of the tab order.
    const leaf = bulletOf('[data-backlink-id="n.follow-up"]');
    expect([referrer.tabIndex, place.tabIndex, leaf.tabIndex]).toEqual([0, 0, -1]);
    expect(referrer.getAttribute("aria-expanded")).toBe("false");
    expect(place.getAttribute("aria-expanded")).toBe("true");
    expect(leaf.hasAttribute("aria-expanded")).toBe(false);

    // Enter on the bullet is the bullet's (a button's click), never the row's open.
    await act(async () => {
      const page = present(referrer.ownerDocument.defaultView, "the bullet's window");
      referrer.dispatchEvent(new page.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(useGraphStore.getState().rootNodeId).toBe(TARGET);
    await act(async () => referrer.click());
    expect(bulletOf('[data-backlink-id="n.decision"]').getAttribute("aria-expanded")).toBe("true");
  });

  it("lays Link over the words' end, never over a tag chip", async () => {
    const tag = wire("t.idea", "idea");
    tag.props[SYSTEM_IDS.typeField] = [{ t: "ref", v: SYSTEM_IDS.tag }];
    const tagged = wire("n.tagged", "please write spec today");
    tagged.props[SYSTEM_IDS.typeField] = [{ t: "ref", v: tag.id }];
    await draw(TARGET, [tag, tagged]);
    await openReferences(true);
    const row = await vi.waitFor(() =>
      present(find('[data-unlinked-mention-id="n.tagged"]'), "tagged mention"),
    );
    const words = present(row.querySelector("[data-row-words]"), "the words' column");
    const action = present(row.querySelector("[data-row-action]"), "Link's overlay");
    const chip = present(row.querySelector("[data-tag-chip]"), "the tag chip");
    expect(words.contains(action)).toBe(true);
    expect(words.contains(chip)).toBe(false);
    // The fade never takes the pointer; only Link's own target does, while shown.
    expect(action.className).toContain("pointer-events-none");
    expect(action.className).not.toMatch(/:pointer-events-auto/);
    const target = present(row.querySelector("[data-row-action-target]"), "Link's target");
    expect(target.contains(row.querySelector('[data-link-mention="n.tagged"]'))).toBe(true);
  });

  it("expands the shown target's children for a contextual backlink", async () => {
    const reference = wire("n.context", "", ["n.own-child"]);
    reference.props[SYSTEM_IDS.refTargetField] = [{ t: "ref", v: TARGET }];
    await draw(TARGET, [
      reference,
      wire("n.own-child", "The reference’s own child"),
      wire("n.shown-child", "The target’s child"),
    ]);
    await act(async () => {
      useGraphStore.getState().applyTx([wire(TARGET, "Write spec", ["n.shown-child"])], [], {
        rev: 2,
      });
    });
    await openReferences();

    const selector = '[data-backlink-id="n.context"]';
    await settled(() => expect(find(selector)).not.toBeNull());
    await act(async () => bulletOf(selector).click());
    expect(find(`${selector} [data-node-block][data-node-id="n.shown-child"]`)).not.toBeNull();
    expect(find(`${selector} [data-node-block][data-node-id="n.own-child"]`)).toBeNull();
  });

  it("shows a few places and a few rows of each, and each place reveals more on its own", async () => {
    // Twelve places, each with five referrers.
    const places = Array.from({ length: 12 }, (_, p) => {
      const rows = Array.from({ length: 5 }, (_row, r) =>
        wire(`n.p${p}-r${r}`, `Row ${r} of place ${p} on [[${TARGET}|Write spec]]`),
      );
      return [
        wire(
          `n.p${p}`,
          `Place ${p}`,
          rows.map((row) => row.id),
        ),
        ...rows,
      ];
    });
    await draw(TARGET, places.flat());
    await settled(() => expect(heading("References").textContent).toContain("62"));
    await openReferences();
    // n.project holds two; the twelve places hold five each.
    expect(count("[data-reference-place]")).toBe(5);
    const fives = [...container.querySelectorAll("[data-reference-place]")].filter(
      (place) => place.getAttribute("data-reference-place") !== "n.project",
    );
    expect(fives.map(shownIn)).toEqual(fives.map(() => 3));

    const before = count("[data-backlink-id]");
    await act(async () =>
      present(
        fives[0]?.querySelector<HTMLElement>("[data-show-more]"),
        "the place's Show more",
      ).click(),
    );
    expect(shownIn(present(fives[0], "place"))).toBe(5);
    expect(count("[data-backlink-id]")).toBe(before + 2);
    // The other places keep what they showed.
    expect(fives.slice(1).map(shownIn)).toEqual(fives.slice(1).map(() => 3));

    await act(async () => showMore("Show 8 more places").click());
    expect(count("[data-reference-place]")).toBe(13);
  });

  it("links a matched span in one undo step and moves the row between sections", async () => {
    await draw(TARGET);
    await openReferences(true);
    await settled(() =>
      expect(find('[data-link-mention="n.plain"]')?.hasAttribute("disabled")).toBe(false),
    );
    // The action is laid over the row, not beside it.
    expect(find('[data-unlinked-mention-id="n.plain"] [data-row-action]')).not.toBeNull();
    await act(async () => present(find('[data-link-mention="n.plain"]'), "Link").click());
    await settled(() => expect(find('[data-backlink-id="n.plain"]')).not.toBeNull());
    expect(find('[data-link-mention="n.plain"]')).toBeNull();
    expect(outlineNodes().get("n.plain")?.text).toBe("we should [[n.spec|write spec]] soon");
    expect(useGraphStore.getState().undoStack).toHaveLength(1);

    await act(async () => {
      dom.window.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
      );
    });
    // Back among the unlinked mentions, which stay open as they were.
    await settled(() =>
      expect(find('[data-link-mention="n.plain"]')?.hasAttribute("disabled")).toBe(false),
    );
    expect(outlineNodes().get("n.plain")?.text).toBe(PLAIN);
  });

  it("reveals the next batch of unlinked mentions on demand", async () => {
    await draw(
      TARGET,
      Array.from({ length: 50 }, (_, i) => wire(`n.mention-${i}`, PLAIN)),
    );
    await settled(() =>
      expect(heading("References").textContent).toBe("References(2 · 51 unlinked)"),
    );
    await openReferences(true);
    expect(count("[data-link-mention]")).toBe(3);
    await act(async () => showMore("Show 10 more").click());
    expect(count("[data-link-mention]")).toBe(13);
  });
});
