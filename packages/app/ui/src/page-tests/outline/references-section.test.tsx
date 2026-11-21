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
  it("names each referrer's ancestor and expands its children in place", async () => {
    await draw(TARGET);
    await settled(() => expect(count("[data-backlink-id]")).toBe(2));
    expect(
      [...container.querySelectorAll("[data-backlink-breadcrumbs]")].map((el) => el.textContent),
    ).toEqual(["Project notes", "Project notes"]);
    expect(find('[data-backlink-relation="f.influences"]')?.textContent).toBe("influenced by");
    const button = present(
      find('[data-backlink-id="n.decision"] button[aria-expanded]'),
      "chevron",
    );
    expect(find('[data-backlink-id] [data-node-block][data-node-id="n.criteria"]')).toBeNull();
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const child = find('[data-backlink-id] [data-node-block][data-node-id="n.criteria"]');
    expect(child?.textContent).toContain("Acceptance criteria");
    expect(child?.dataset.instanceKey).not.toBe(
      childInstanceKey(projectedRowKey(TARGET, "n.decision"), "n.criteria"),
    );
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

    const selector = '[data-backlink-id="n.context"]';
    await settled(() => expect(find(`${selector} button[aria-expanded]`)).not.toBeNull());
    await act(async () => present(find(`${selector} button[aria-expanded]`), "chevron").click());
    expect(find(`${selector} [data-node-block][data-node-id="n.shown-child"]`)).not.toBeNull();
    expect(find(`${selector} [data-node-block][data-node-id="n.own-child"]`)).toBeNull();
  });

  it("links a matched span in one undo step and moves the row between sections", async () => {
    await draw(TARGET);
    await settled(() =>
      expect(find('[data-link-mention="n.plain"]')?.hasAttribute("disabled")).toBe(false),
    );
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
    await settled(() =>
      expect(find('[data-link-mention="n.plain"]')?.hasAttribute("disabled")).toBe(false),
    );
    expect(outlineNodes().get("n.plain")?.text).toBe(PLAIN);
    expect(find('[data-backlink-id="n.plain"]')).toBeNull();
  });

  it("reveals the next batch of unlinked mentions on demand", async () => {
    await draw(
      TARGET,
      Array.from({ length: 50 }, (_, i) => wire(`n.mention-${i}`, PLAIN)),
    );
    await settled(() => expect(count("[data-link-mention]")).toBe(50));
    const more = present(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Show more (1 remaining)"),
      ),
      "Show more",
    );
    await act(async () => more.click());
    expect(count("[data-link-mention]")).toBe(51);
  });
});
