/**
 * What the 2D stage draws again on a change (DESIGN-UI.md → Canvas →
 * Update cost): a camera move draws no item and no edge again, a moved item
 * draws itself and the edges at its ends, a change elsewhere in the store
 * draws nothing again, and the stage draws only what its floor window
 * meets — but the selection wherever it is. A pan inside the window's
 * cells draws nothing, and one across them draws only what it brings in.
 * These are the counts the canvas's frame times rest on; the frame times
 * themselves are measured, not gated here.
 */
// GAP [[01M5PMJEGCJPMVNCKBDYZ0V57G]] the 60fps bar is measured on a scratch benchmark, not gated
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as KbCanvas from "@kb/canvas";
import type { CanvasDoc, CanvasEdge, CanvasGroupNode, CanvasNode } from "@kb/canvas";
import type * as CardBox from "./canvas-card-box";
import type { OutlineNode } from "@kb/ui-sdk";
import { EMPTY_SELECTION, selectNode, type CanvasSelection } from "./canvas-selection";

/** Every item and every edge drawn, by id, in the order they were; and how often the items were walked. */
const drawn = vi.hoisted(() => ({ items: [] as string[], edges: [] as string[], walks: 0 }));

// Each item is laid out once per draw (`cardBoxStyle`), each edge painted once (`edgePaint`),
// and the item layer walks the items in paint order once each time it is drawn (`paintOrder`).
vi.mock("./canvas-card-box", async (importOriginal) => {
  const actual = await importOriginal<typeof CardBox>();
  return {
    ...actual,
    cardBoxStyle: (card: CanvasNode) => {
      drawn.items.push(card.id);
      return actual.cardBoxStyle(card);
    },
  };
});
vi.mock("@kb/canvas", async (importOriginal) => {
  const actual = await importOriginal<typeof KbCanvas>();
  return {
    ...actual,
    edgePaint: (edge: CanvasEdge, ...rest: [Parameters<typeof actual.edgePaint>[1]]) => {
      drawn.edges.push(edge.id);
      return actual.edgePaint(edge, ...rest);
    },
    paintOrder: (nodes: readonly CanvasNode[]) => {
      drawn.walks += 1;
      return actual.paintOrder(nodes);
    },
  };
});

import { CanvasStage } from "./canvas-stage";

const noop = () => {};

/** A row of `count` cards 200 apart, each joined to the next. */
function row(count: number): CanvasDoc {
  const nodes: CanvasNode[] = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    type: "text",
    text: `card ${i}`,
    x: i * 200,
    y: 0,
    width: 120,
    height: 60,
  }));
  const edges: CanvasEdge[] = nodes.slice(1).map((node, i) => ({
    id: `e${i}`,
    fromNode: `n${i}`,
    toNode: node.id,
  }));
  return { nodes, edges };
}

interface Shown {
  readonly doc: CanvasDoc;
  readonly pan?: { x: number; y: number };
  readonly zoom?: number;
  readonly selection?: CanvasSelection;
  readonly nodes?: ReadonlyMap<string, OutlineNode>;
}

let root: Root;
let container: HTMLElement;

/** Draw the stage as `shown` says, every handler made anew as a page makes them. */
function show({ doc, pan = { x: 0, y: 0 }, zoom = 1, selection = EMPTY_SELECTION, nodes }: Shown) {
  act(() =>
    root.render(
      createElement(CanvasStage, {
        doc,
        nodes: nodes ?? new Map(),
        byId: new Map(doc.nodes.map((n) => [n.id, n])),
        selection,
        pan,
        zoom,
        panning: false,
        toolState: { tool: "select" },
        editingEdgeLabel: null,
        edgeDrag: null,
        carrying: false,
        snapGuides: [],
        marqueeRect: null,
        onEditingEdgeLabelChange: () => {},
        onEdgeLabelCommit: () => {},
        onCardSelect: () => {},
        onCardChange: () => {},
        onResizeStart: () => {},
        onRotateStart: () => {},
        onPortDown: () => {},
        onWheel: () => {},
        onPointerDownStage: () => {},
        onModalPress: () => false,
        onPointerMove: () => {},
        onPointerUp: () => {},
        onPointerCancel: () => {},
        onDoubleClickStage: () => {},
        handleCardPointerDown: () => {},
        handleEdgeClick: () => {},
        editing: null,
        onEdit: () => {},
      }),
    ),
  );
}

/** What the next `act` draws: the ids drawn while `change` runs. */
function drawnBy(change: () => void): { items: string[]; edges: string[] } {
  drawn.items.length = 0;
  drawn.edges.length = 0;
  drawn.walks = 0;
  change();
  return { items: [...drawn.items], edges: [...drawn.edges] };
}

const cardsShown = () =>
  [...container.querySelectorAll<HTMLElement>("[data-card-id]")].map((el) => el.dataset.cardId);
const edgesShown = () =>
  [...container.querySelectorAll<HTMLElement>("[data-edge-id]")].map((el) => el.dataset.edgeId);

/** A 40-unit card at `x`, `y`. */
const smallCard = (id: string, x: number, y: number): CanvasNode => ({
  id,
  type: "text",
  text: id,
  x,
  y,
  width: 40,
  height: 40,
});

/** An edge from `from` to `to`, named for its ends. */
const joined = (from: string, to: string): CanvasEdge => ({
  id: `${from}${to}`,
  fromNode: from,
  toNode: to,
});

/** `doc` with `frame` added at its foot, holding the first `held` items. */
function framed(doc: CanvasDoc, held: number): CanvasDoc {
  const frame: CanvasGroupNode = {
    id: "f",
    type: "group",
    label: "f",
    x: -20,
    y: -20,
    width: held * 200,
    height: 100,
  };
  const nodes = doc.nodes.map((node, i) => (i < held ? { ...node, parent: "f" } : node));
  return { ...doc, nodes: [frame, ...nodes] };
}

beforeAll(() => {
  const win = new Window({ url: "https://kb.test/" });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("what the 2D stage draws again", () => {
  it("a camera move draws no item and no edge again", () => {
    const doc = row(50);
    show({ doc });
    const moved = drawnBy(() => {
      show({ doc, pan: { x: -40, y: 12 } });
      show({ doc, pan: { x: -80, y: 24 }, zoom: 1.1 });
    });
    expect(moved).toEqual({ items: [], edges: [] });
  });

  it("a moved item draws itself and the edges at its ends, and nothing else", () => {
    const doc = row(50);
    show({ doc });
    const [first, second, ...rest] = doc.nodes;
    if (first === undefined || second === undefined) throw new Error("a row of cards");
    const dragged = { ...doc, nodes: [first, { ...second, x: second.x + 15 }, ...rest] };
    expect(drawnBy(() => show({ doc: dragged }))).toEqual({ items: ["n1"], edges: ["e0", "e1"] });
  });

  it("a change elsewhere in the store draws nothing again", () => {
    const doc = row(50);
    show({ doc, nodes: new Map() });
    expect(drawnBy(() => show({ doc, nodes: new Map() }))).toEqual({ items: [], edges: [] });
  });

  it("an edit elsewhere draws no item a frame holds again", () => {
    const doc = framed(row(20), 5);
    show({ doc });
    const nodes = doc.nodes.map((node) => (node.id === "n10" ? { ...node, y: 30 } : node));
    expect(drawnBy(() => show({ doc: { ...doc, nodes } })).items).toEqual(["n10"]);
  });

  it("selecting an item draws that item, and no other", () => {
    const doc = row(50);
    show({ doc });
    expect(drawnBy(() => show({ doc, selection: selectNode("n3") })).items).toEqual(["n3"]);
  });
});

describe("what the 2D stage draws at all", () => {
  const size = { width: 800, height: 600 };
  let restore = noop;

  beforeEach(() => {
    // The stage measures itself (`useStageSize`): here, a fixed 800 by 600.
    const proto = window.HTMLElement.prototype;
    const width = Object.getOwnPropertyDescriptor(proto, "clientWidth");
    const height = Object.getOwnPropertyDescriptor(proto, "clientHeight");
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => size.width });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => size.height });
    class Measured {
      readonly told: () => void;
      constructor(told: () => void) {
        this.told = told;
      }
      observe() {
        this.told();
      }
      disconnect() {}
    }
    const was = globalThis.ResizeObserver;
    Object.assign(globalThis, { ResizeObserver: Measured });
    restore = () => {
      if (width !== undefined) Object.defineProperty(proto, "clientWidth", width);
      if (height !== undefined) Object.defineProperty(proto, "clientHeight", height);
      Object.assign(globalThis, { ResizeObserver: was });
    };
  });

  afterEach(() => restore());

  it("draws the items near the view, not those far off", () => {
    const doc = row(200);
    show({ doc });
    show({ doc });
    const shown = cardsShown();
    expect(shown).toContain("n0");
    expect(shown).toContain("n3");
    expect(shown).not.toContain("n100");
    expect(shown.length).toBeLessThan(20);
  });

  it("draws the selection wherever it is", () => {
    const doc = row(200);
    show({ doc, selection: selectNode("n150") });
    show({ doc, selection: selectNode("n150") });
    expect(cardsShown()).toContain("n150");
  });

  // At zoom 1 on 800 by 600 a cell is 400 by 300, and these pans stay inside one.
  it("a pan inside the window's cells draws nothing again, not even the item layer", () => {
    const doc = row(200);
    show({ doc, pan: { x: -200, y: -150 } });
    show({ doc, pan: { x: -200, y: -150 } });
    const before = cardsShown();
    const moved = drawnBy(() => show({ doc, pan: { x: -300, y: -200 } }));
    expect(moved).toEqual({ items: [], edges: [] });
    expect(drawn.walks).toBe(0);
    expect(cardsShown()).toEqual(before);
  });

  it("a pan across a cell draws only what it brings in", () => {
    const doc = row(200);
    show({ doc, pan: { x: -200, y: -150 } });
    show({ doc, pan: { x: -200, y: -150 } });
    const before = new Set(cardsShown());
    const edgesBefore = new Set(edgesShown());
    const moved = drawnBy(() => show({ doc, pan: { x: -600, y: -150 } }));
    const entered = cardsShown().filter((id) => !before.has(id));
    expect(entered.length).toBeGreaterThan(0);
    // Each drawn once, and only those.
    expect(moved.items).toHaveLength(entered.length);
    expect(new Set(moved.items)).toEqual(new Set(entered));
    const edgesEntered = edgesShown().filter((id) => !edgesBefore.has(id));
    expect(moved.edges).toHaveLength(edgesEntered.length);
    expect(new Set(moved.edges)).toEqual(new Set(edgesEntered));
  });

  it("draws an edge whose label reaches into the window, though its line is out of it", () => {
    // The window at this pan runs to x 1600; the cards and the line between them stand past it.
    const nodes = [smallCard("a", 1700, 0), smallCard("b", 1700, 600)];
    const edge = (label?: string): CanvasEdge => ({
      ...joined("a", "b"),
      ...(label === undefined ? {} : { label }),
    });
    const pan = { x: -200, y: -150 };
    show({ doc: { nodes, edges: [edge()] }, pan });
    show({ doc: { nodes, edges: [edge()] }, pan });
    expect(cardsShown()).toEqual([]);
    expect(edgesShown()).toEqual([]);
    show({ doc: { nodes, edges: [edge("x".repeat(60))] }, pan });
    expect(edgesShown()).toEqual(["ab"]);
  });

  it("draws what a pan brings near", () => {
    const doc = row(200);
    show({ doc });
    show({ doc, pan: { x: -150 * 200, y: 0 } });
    const shown = cardsShown();
    expect(shown).toContain("n150");
    expect(shown).not.toContain("n0");
  });
});
