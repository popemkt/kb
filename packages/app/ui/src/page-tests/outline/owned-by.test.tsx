/**
 * A seeded node's page says who owns it: its owner's node (`:node/owner`,
 * read through `GraphRead.ownerOf`) as a chip under the title, by the
 * owner's label as it stands. A person's node has none.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { syncUiPlugins } from "@kb/ui-sdk";
import { extensionNodeId } from "@kb/model";
import { OutlineEditor } from "@kb/outline-ui";
import { outlineUiPlugin } from "@/test-support/outline-plugin";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/api/fixture-graph";
import { mutations } from "@/actions/mutations";
import { resetPushLaneForTests } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";

const AT = "2026-08-08T05:00:00.000Z";
/** Core's own node: the family that seeds `sys.field`. */
const CORE = extensionNodeId("core");

describe("a page's owner chip", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    syncPagePlugins([outlineUiPlugin]);
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => syncUiPlugins([]));
  beforeEach(() => {
    resetOutlineStore();
    const core = { id: CORE, text: "Core", props: {}, children: [], createdAt: AT, updatedAt: AT };
    useGraphStore
      .getState()
      .hydrateFromWire(
        [...structuredClone(fixtureGraph.nodes).filter((node) => node.id !== CORE), core],
        fixtureGraph.rev,
        "fixtures",
      );
    resetPushLaneForTests();
    setPostAction(null);
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const chip = () => container.querySelector<HTMLElement>("[data-owned-by]");

  it("names a seeded node's owner, by its label as it stands", async () => {
    await act(async () => {
      root.render(<OutlineEditor root="sys.field" />);
    });
    expect(chip()?.dataset["ownedBy"]).toBe(CORE);
    expect(chip()?.textContent).toBe("Owned byCore");

    // The owner's label is the person's; the chip reads it as it stands.
    await act(() => mutations.updateNodeContent(CORE, "Kernel"));
    expect(chip()?.textContent).toBe("Owned byKernel");
  });

  it("is absent from a person's node", async () => {
    await act(async () => {
      root.render(<OutlineEditor root="n.root-a" />);
    });
    expect(container.querySelector('[data-zoom-title="true"]')).not.toBeNull();
    expect(chip()).toBeNull();
  });
});
