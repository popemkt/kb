/**
 * What the 2D stage draws again on a change (DESIGN-UI.md → Canvas →
 * Update cost): a camera move draws no item and no edge again, a moved item
 * draws itself and the edges at its ends, a change elsewhere in the store
 * draws nothing again, and the stage draws only what its floor window
 * meets — but the selection wherever it is.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as KbCanvas from "@kb/canvas";
import type { CanvasDoc, CanvasEdge, CanvasNode } from "@kb/canvas";
import type * as CardBox from "./canvas-card-box";
import type { OutlineNode } from "@kb/ui-sdk";
import { EMPTY_SELECTION, selectNode, type CanvasSelection } from "./canvas-selection";

/** Every item and every edge drawn, by id, in the order they were. */
const drawn = vi.hoisted(() => ({ items: [] as string[], edges: [] as string[] }));

// Each item is laid out once per draw (`cardBoxStyle`), and each edge painted once (`edgePaint`).
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
  change();
  return { items: [...drawn.items], edges: [...drawn.edges] };
}

const cardsShown = () =>
  [...container.querySelectorAll<HTMLElement>("[data-card-id]")].map((el) => el.dataset.cardId);

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

  it("draws what a pan brings near", () => {
    const doc = row(200);
    show({ doc });
    show({ doc, pan: { x: -150 * 200, y: 0 } });
    const shown = cardsShown();
    expect(shown).toContain("n150");
    expect(shown).not.toContain("n0");
  });
});
