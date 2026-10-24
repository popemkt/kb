import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import { CANVAS_IDS, CanvasView, stringifyCanvasDoc, type CanvasDoc } from "@kb/canvas";
import { definePlugin } from "@kb/plugin";
import {
  ScriptHostService,
  syncUiPlugins,
  SYSTEM_IDS,
  type OutlineNode,
  type ScriptHostProps,
} from "@kb/ui-sdk";
import type { KbEvent, SandboxAnchors } from "@kb/sandbox";
import { testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";

const { persistCanvasDoc, createCanvasNode } = vi.hoisted(() => ({
  persistCanvasDoc: vi
    .fn<(canvasId: string, doc: CanvasDoc, opts?: unknown) => Promise<boolean>>()
    .mockResolvedValue(true),
  createCanvasNode: vi.fn<(text?: string, parent?: string) => Promise<string | null>>(),
}));

vi.mock("./canvas-api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, persistCanvasDoc, createCanvasNode };
});

import { CanvasPage } from "./canvas-page";

// The canvas reads its node through the page's host: here, a test host.
const host = testBrowserHost();
beforeAll(() => syncUiPlugins([testHostPlugin(host)]));
afterAll(() => syncUiPlugins([]));

const initialDoc: CanvasDoc = {
  nodes: [
    { id: "a", type: "shape", shape: "rect", x: 20, y: 20, width: 100, height: 80 },
    { id: "b", type: "shape", shape: "rect", x: 220, y: 20, width: 100, height: 80 },
  ],
  edges: [],
};

const canvasNode: OutlineNode = {
  id: "canvas",
  text: "Characterization canvas",
  parentId: null,
  children: [],
  collapsed: false,
  props: {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: CANVAS_IDS.canvasTag }],
    [CANVAS_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(initialDoc) }],
  },
  tags: [],
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
};

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: PointerEventInit,
): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }),
    );
  });
}

/** A key pressed on the window, as the canvas hears it. */
const key = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });

/** A right-click on `target`; whether its menu was taken from the browser. */
function rightClick(target: EventTarget): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** Past the canvas's persist debounce. */
const settle = () => act(async () => new Promise((done) => setTimeout(done, 350)));

describe("CanvasPage pointer interactions", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window({ url: "https://kb.test/canvas/canvas" });
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.SVGElement = dom.SVGElement;
    g.Node = dom.Node;
    g.Event = dom.Event;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.PointerEvent = dom.PointerEvent;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(dom.HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: () => undefined,
    });
  });

  beforeEach(() => {
    persistCanvasDoc.mockClear();
    host.setNodes([canvasNode]);
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("tells the scripts host its subjects, view, events and where its items are", async () => {
    const hosted: ScriptHostProps[] = [];
    const heard: KbEvent[] = [];
    const placed: SandboxAnchors[] = [];
    const scripts = definePlugin({
      name: "scripts",
      apply: (ctx) =>
        ctx.provide(ScriptHostService, (props: ScriptHostProps) => {
          if (!hosted.includes(props)) {
            hosted.push(props);
            if (hosted.length === 1) {
              props.events.listen((event) => heard.push(event));
              props.layout.listen((layout) => placed.push(layout.anchors));
            }
          }
          return null;
        }),
    });
    act(() => syncUiPlugins([testHostPlugin(host), scripts]));
    try {
      await act(async () => {
        root.render(<CanvasPage canvasId="canvas" />);
      });
      const last = present(hosted.at(-1), "script host props");
      expect(last.subjects).toEqual(["canvas"]);
      expect(last.view).toBe(CanvasView);
      const cardA = present(
        container.querySelector('[data-card-id="a"] .group\\/card'),
        "first card",
      );
      dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 60, clientY: 60 });
      dispatchPointer(cardA, "pointermove", { button: 0, clientX: 90, clientY: 60 });
      dispatchPointer(cardA, "pointermove", { button: 0, clientX: 100, clientY: 60 });
      dispatchPointer(cardA, "pointerup", { button: 0, clientX: 100, clientY: 60 });
      await settle();
      expect(heard).toContainEqual({
        type: "canvas.item.click",
        target: "a",
        value: { canvas: "canvas" },
      });
      expect(heard).toContainEqual({
        type: "canvas.selection",
        target: null,
        value: { canvas: "canvas", items: ["a"], edges: [] },
      });
      expect(heard.some((event) => event.type === "canvas.change")).toBe(true);
      // The card's anchor went with it, its size kept.
      const before = present(placed.find((anchors) => "a" in anchors)?.a, "first anchor");
      const after = present(placed.at(-1)?.a, "last anchor");
      expect(after.left).toBeGreaterThan(before.left);
      expect(after.right - after.left).toBeCloseTo(before.right - before.left, 3);
    } finally {
      act(() => syncUiPlugins([testHostPlugin(host)]));
    }
  });

  it("a board's pages are a strip; a tab or ⌥→ opens the next, and an item named is selected", async () => {
    const page: OutlineNode = {
      ...canvasNode,
      id: "p2",
      text: "Page two",
      parentId: "canvas",
      props: { ...canvasNode.props },
    };
    host.setNodes([{ ...canvasNode, children: ["p2"] }, page]);
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" item="b" />);
    });
    const strip = present(container.querySelector("nav[aria-label='Pages']"), "page strip");
    const tabs = [...strip.querySelectorAll("button")].map((b) => b.textContent);
    expect(tabs).toEqual(["Characterization canvas", "Page two", "New page"]);
    expect(strip.querySelector("[aria-current='page']")?.textContent).toBe(
      "Characterization canvas",
    );
    // Arrived at item b: it is selected, so it wears its handles.
    expect(container.querySelector('[data-card-id="b"] [data-resize]')).not.toBeNull();
    expect(container.querySelector('[data-card-id="a"] [data-resize]')).toBeNull();
    key({ key: "ArrowRight", altKey: true });
    expect(window.location.pathname).toBe("/canvas/p2");
    window.history.pushState({}, "", "/canvas/canvas");
    act(() => [...strip.querySelectorAll("button")][1]?.click());
    expect(window.location.pathname).toBe("/canvas/p2");
  });

  it("new page makes one page however often it is pressed, under the next free name", async () => {
    const making = Promise.withResolvers<string | null>();
    createCanvasNode.mockReturnValue(making.promise);
    const page: OutlineNode = { ...canvasNode, id: "p3", text: "Page 2", parentId: "canvas" };
    host.setNodes([{ ...canvasNode, children: ["p3"] }, page]);
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    const create = () =>
      [...container.querySelectorAll("nav[aria-label='Pages'] button")]
        .find((b) => b.textContent === "New page")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    act(() => {
      create();
    });
    act(() => {
      create();
    });
    expect(createCanvasNode.mock.calls).toEqual([["Page 3", "canvas"]]);
    await act(async () => making.resolve("p4"));
    expect(window.location.pathname).toBe("/canvas/p4");
  });

  it("selects, drags, marquees, pans, resizes, connects, and undoes through the DOM", async () => {
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });

    const canvasStage = present(
      container.querySelector("[data-canvas-stage]"),
      "canvas stage contents",
    );
    const transformLayer = present(canvasStage.parentElement, "canvas transform layer");
    const pointerSurface = present(transformLayer.parentElement, "canvas pointer surface");

    const cardA = present(
      container.querySelector('[data-card-id="a"] .group\\/card'),
      "first card",
    );
    dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 60, clientY: 60 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 70, clientY: 70 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 80, clientY: 70 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 80, clientY: 70 });

    dispatchPointer(pointerSurface, "pointerdown", { button: 0, clientX: 40, clientY: 40 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 450, clientY: 250 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 451, clientY: 251 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 451, clientY: 251 });
    expect(
      present(container.querySelector('[data-card-id="a"]'), "marquee card a").querySelector(
        "[data-resize]",
      ),
    ).not.toBeNull();
    expect(
      present(container.querySelector('[data-card-id="b"]'), "marquee card b").querySelector(
        "[data-resize]",
      ),
    ).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Space", key: " " }),
      );
    });
    dispatchPointer(pointerSurface, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 140, clientY: 130 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 140, clientY: 130 });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, code: "Space", key: " " }));
    });
    expect(transformLayer.getAttribute("style")).toContain("translate(80px, 70px)");

    const resizeA = present(
      container.querySelector('[data-card-id="a"] [data-resize="se"]'),
      "first card resize handle",
    );
    dispatchPointer(resizeA, "pointerdown", { button: 0, clientX: 0, clientY: 0 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 20, clientY: 15 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 25, clientY: 20 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 25, clientY: 20 });

    const fromPort = present(
      container.querySelector('[data-card-id="a"] [data-port="right"]'),
      "first card right port",
    );
    const cardB = present(container.querySelector('[data-card-id="b"]'), "second card");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(cardB);
    dispatchPointer(fromPort, "pointerdown", { button: 0, clientX: 165, clientY: 140 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 300, clientY: 130 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 300, clientY: 130 });
    await act(async () => Promise.resolve());

    const withEdge = persistCanvasDoc.mock.calls.find(([, doc]) => doc.edges.length === 1)?.[1];
    expect(withEdge).toBeDefined();
    expect(withEdge?.edges[0]).toMatchObject({
      fromNode: "a",
      toNode: "b",
      fromSide: "right",
      toSide: "left",
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true }),
      );
    });
    await act(async () => Promise.resolve());

    const lastPersist = present(persistCanvasDoc.mock.calls.at(-1), "undo persistence")[1];
    expect(lastPersist.edges).toEqual([]);
    expect(lastPersist.nodes.find((node) => node.id === "a")).toMatchObject({
      x: 40,
      y: 30,
      width: 125,
      height: 100,
    });
  });

  it("a member stands for its group until the group is entered; Esc leaves it; ⌘⇧G takes it apart", async () => {
    const framed: CanvasDoc = {
      nodes: [
        { id: "f", type: "group", label: "Ideas", x: 0, y: 0, width: 400, height: 200 },
        { id: "a", type: "text", text: "a", x: 20, y: 40, width: 120, height: 60, parent: "f" },
        { id: "b", type: "text", text: "b", x: 220, y: 40, width: 120, height: 60, parent: "f" },
      ],
      edges: [],
    };
    const node: OutlineNode = {
      ...canvasNode,
      props: {
        ...canvasNode.props,
        [CANVAS_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(framed) }],
      },
    };
    host.setNodes([node]);
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    const canvasStage = present(container.querySelector("[data-canvas-stage]"), "stage");
    const pointerSurface = present(canvasStage.parentElement?.parentElement, "pointer surface");
    const faceOf = (id: string) =>
      present(container.querySelector(`[data-card-id="${id}"] .group\\/card`), `card ${id}`);
    const selected = () =>
      [...container.querySelectorAll<HTMLElement>("[data-card-id][data-selected]")].map(
        (el) => el.dataset.cardId,
      );
    const chip = () => container.querySelector('[data-testid="canvas-scope"]');

    // A press on a member selects its group, and a drag carries the group with its members.
    dispatchPointer(faceOf("a"), "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(selected()).toEqual(["f"]);
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 110, clientY: 100 });
    dispatchPointer(pointerSurface, "pointermove", { button: 0, clientX: 137, clientY: 100 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 137, clientY: 100 });
    await settle();
    const carried = persistCanvasDoc.mock.calls.at(-1)?.[1];
    expect(carried?.nodes.map((n) => [n.id, n.x])).toEqual([
      ["f", 37],
      ["a", 57],
      ["b", 257],
    ]);

    // A double-click enters the group, selecting the member under it; Esc leaves, selecting the group.
    act(() => {
      faceOf("a").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    expect(selected()).toEqual(["a"]);
    expect(chip()?.textContent).toContain("Ideas");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(chip()).toBeNull();
    expect(selected()).toEqual(["f"]);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "G", metaKey: true, shiftKey: true }),
      );
    });
    await settle();
    const apart = persistCanvasDoc.mock.calls.at(-1)?.[1];
    expect(apart?.nodes.map((n) => [n.id, n.parent])).toEqual([
      ["a", undefined],
      ["b", undefined],
    ]);
    expect(selected()).toEqual(["a", "b"]);
  });

  it("present mode ends with its frame, and a frame made later does not bring it back", async () => {
    const framed: CanvasDoc = {
      nodes: [
        { id: "f", type: "group", label: "Ideas", x: 0, y: 0, width: 300, height: 200 },
        { id: "b", type: "text", text: "b", x: 500, y: 40, width: 120, height: 60 },
      ],
      edges: [],
    };
    const node: OutlineNode = {
      ...canvasNode,
      props: {
        ...canvasNode.props,
        [CANVAS_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(framed) }],
      },
    };
    host.setNodes([node]);
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    const canvasStage = present(container.querySelector("[data-canvas-stage]"), "stage");
    const pointerSurface = present(canvasStage.parentElement?.parentElement, "pointer surface");
    const press = (id: string) => {
      const face = present(container.querySelector(`[data-card-id="${id}"] .group\\/card`), id);
      dispatchPointer(face, "pointerdown", { button: 0, clientX: 520, clientY: 60 });
      dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 520, clientY: 60 });
    };
    const bar = () => container.querySelector('[data-testid="canvas-present-bar"]');

    act(() => {
      present(container.querySelector<HTMLElement>('[title^="View menu"]'), "view menu").click();
    });
    const start = [...container.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) =>
      item.textContent.startsWith("Present frames"),
    );
    act(() => start?.click());
    expect(bar()?.textContent).toContain("Ideas");

    // The frame presented is deleted: present mode ends.
    press("f");
    key({ key: "Delete" });
    expect(bar()).toBeNull();

    // A frame made later is not presented, and the arrows nudge again.
    press("b");
    key({ key: "g", metaKey: true });
    expect(bar()).toBeNull();
    key({ key: "ArrowRight", shiftKey: true });
    await settle();
    const last = persistCanvasDoc.mock.calls.at(-1)?.[1];
    expect(last?.nodes.find((n) => n.id === "b")?.x).toBe(510);
  });

  it("a placing tool sees through a frame: what it places there belongs to the frame", async () => {
    const framed: CanvasDoc = {
      nodes: [{ id: "f", type: "group", label: "Ideas", x: 0, y: 0, width: 600, height: 400 }],
      edges: [],
    };
    const node: OutlineNode = {
      ...canvasNode,
      props: {
        ...canvasNode.props,
        [CANVAS_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(framed) }],
      },
    };
    host.setNodes([node]);
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "r" }));
    });
    const frame = present(container.querySelector('[data-card-id="f"] .group\\/card'), "frame");
    const canvasStage = present(container.querySelector("[data-canvas-stage]"), "stage contents");
    const surface = present(canvasStage.parentElement?.parentElement, "pointer surface");
    // A click places the rectangle at its own size, centred where it was pressed.
    dispatchPointer(frame, "pointerdown", { button: 0, clientX: 200, clientY: 200 });
    dispatchPointer(surface, "pointerup", { button: 0, clientX: 200, clientY: 200 });
    await settle();
    const placed = persistCanvasDoc.mock.calls.at(-1)?.[1].nodes.at(-1);
    expect(placed).toMatchObject({ type: "shape", shape: "rect", parent: "f", width: 160 });
    // A drag draws one out from where it went down to where it is let go.
    key({ key: "o" });
    dispatchPointer(frame, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    dispatchPointer(surface, "pointermove", { button: 0, clientX: 160, clientY: 140 });
    dispatchPointer(surface, "pointermove", { button: 0, clientX: 180, clientY: 160 });
    dispatchPointer(surface, "pointerup", { button: 0, clientX: 180, clientY: 160 });
    await settle();
    const drawn = persistCanvasDoc.mock.calls.at(-1)?.[1].nodes.at(-1);
    expect(drawn).toMatchObject({ shape: "ellipse", parent: "f", width: 80, height: 60 });
  });

  it("the arrow tool draws an arrow from one item to another as the edge between them", async () => {
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    const canvasStage = present(container.querySelector("[data-canvas-stage]"), "stage contents");
    const surface = present(canvasStage.parentElement?.parentElement, "pointer surface");
    const cardA = present(container.querySelector('[data-card-id="a"] .group\\/card'), "card a");
    key({ key: "a" });
    // a is at (20,20) 100×80 and b at (220,20), the stage panned 40 in: from a's middle to b's.
    dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 110, clientY: 100 });
    dispatchPointer(surface, "pointermove", { button: 0, clientX: 200, clientY: 100 });
    dispatchPointer(surface, "pointermove", { button: 0, clientX: 300, clientY: 100 });
    dispatchPointer(surface, "pointerup", { button: 0, clientX: 300, clientY: 100 });
    await settle();
    const written = persistCanvasDoc.mock.calls.at(-1)?.[1];
    expect(written?.edges).toEqual([
      expect.objectContaining({ fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" }),
    ]);
    // The preview drawn on the way is gone: the edge is all that was written.
    expect(written?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("a right-click opens the context menu on what it lands on; its rows are the keymap's commands", async () => {
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    const canvasStage = present(container.querySelector("[data-canvas-stage]"), "stage contents");
    const surface = present(canvasStage.parentElement?.parentElement, "pointer surface");
    const cardB = present(container.querySelector('[data-card-id="b"] .group\\/card'), "card b");
    const menu = () => container.querySelector('[data-testid="canvas-context-menu"]');
    const row = (label: string) =>
      [...(menu()?.querySelectorAll("[role=menuitem]") ?? [])].find((el) =>
        el.textContent.startsWith(label),
      ) as HTMLButtonElement | undefined;
    expect(rightClick(cardB)).toBe(true);
    // b is selected, and the menu offers what is done to it, with its keys.
    expect(row("Delete")?.textContent).toContain("Del");
    expect(row("Undo")).toBeUndefined();
    // Nothing to ungroup in a rectangle.
    expect(row("Ungroup")).toBeUndefined();
    act(() => row("Delete")?.click());
    expect(menu()).toBeNull();
    await settle();
    expect(persistCanvasDoc.mock.calls.at(-1)?.[1].nodes.map((n) => n.id)).toEqual(["a"]);
    // On empty canvas: what is done to the canvas.
    expect(rightClick(surface)).toBe(true);
    expect(row("Delete")).toBeUndefined();
    act(() => row("Undo")?.click());
    await settle();
    expect(persistCanvasDoc.mock.calls.at(-1)?.[1].nodes.map((n) => n.id)).toEqual(["a", "b"]);
    // Over words being typed the menu is the browser's.
    const cardA = present(container.querySelector('[data-card-id="a"] .group\\/card'), "card a");
    expect(rightClick(cardA)).toBe(true);
    act(() => row("Edit its words")?.click());
    expect(menu()).toBeNull();
    const words = present(dom.document.activeElement, "the open editor");
    expect(["INPUT", "TEXTAREA"]).toContain(words.tagName);
    expect(rightClick(words as unknown as Element)).toBe(false);
    expect(menu()).toBeNull();
    // The zoom readout is the zoom menu's button.
    const zoom = present(container.querySelector<HTMLElement>('button[title="Zoom"]'), "zoom");
    expect(zoom.textContent).toBe("100%");
    act(() => zoom.click());
    const zoomIn = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="canvas-zoom-menu"] [role=menuitem]',
      ),
    ].find((el) => el.textContent.startsWith("Zoom in"));
    act(() => zoomIn?.click());
    expect(zoom.textContent).not.toBe("100%");
    expect(container.querySelector('[data-testid="canvas-zoom-menu"]')).toBeNull();
  });

  it("a double-click on empty canvas makes a text card that is typed into at once, as ↵ opens one", async () => {
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    const canvasStage = present(container.querySelector("[data-canvas-stage]"), "stage contents");
    const surface = present(canvasStage.parentElement?.parentElement, "pointer surface");
    act(() => {
      surface.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 600, clientY: 500 }),
      );
    });
    const made = [...container.querySelectorAll("[data-card-id]")].find(
      (el) => !["a", "b"].includes(el.getAttribute("data-card-id") ?? ""),
    );
    const field = present(made?.querySelector("textarea"), "the new card's field");
    expect(dom.document.activeElement).toBe(field);
    // Left, then ↵ with it selected: its words are open again.
    act(() => field.blur());
    expect(dom.document.activeElement).not.toBe(field);
    key({ key: "Enter" });
    expect(dom.document.activeElement).toBe(field);
  });

  describe("comments", () => {
    const thread: OutlineNode = {
      ...canvasNode,
      id: "t1",
      text: "look here",
      parentId: "canvas",
      children: ["r1"],
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: CANVAS_IDS.commentTag }],
        [CANVAS_IDS.commentCanvasField]: [{ t: "ref", v: "canvas" }],
        [CANVAS_IDS.commentItemField]: [{ t: "str", v: "b" }],
        [CANVAS_IDS.commentStateField]: [{ t: "ref", v: CANVAS_IDS.commentOpen }],
      },
    };
    const reply: OutlineNode = {
      ...canvasNode,
      id: "r1",
      text: "agreed",
      parentId: "t1",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: CANVAS_IDS.commentTag }] },
    };
    const panel = () => dom.document.querySelector('[data-testid="comment-panel"]');
    /** Write `text` into the panel and send it with its button. */
    const write = async (text: string) => {
      const area = present(panel()?.querySelector("textarea"), "the panel's field");
      await act(async () => {
        // Past React's own record of the value, as typing is.
        Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")?.set?.call(
          area,
          text,
        );
        // React-dom came in before this DOM did, so it hears typing by the keys, not `input`.
        area.dispatchEvent(new dom.KeyboardEvent("keyup", { bubbles: true, key: "e" }));
      });
      const send = [...(panel()?.querySelectorAll("button") ?? [])].at(-1);
      await act(async () => present(send, "the panel's send").click());
    };
    const wrote = { status: "succeeded", id: "ext.canvas.comment", output: { id: "t2" } } as const;

    const sides = ["clientWidth", "clientHeight"] as const;
    let held: (PropertyDescriptor | undefined)[] = [];
    beforeEach(() => {
      held = sides.map((side) => Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, side));
      // A stage with room: the pins stand on it.
      for (const side of sides) {
        Object.defineProperty(dom.HTMLElement.prototype, side, { configurable: true, value: 800 });
      }
    });
    afterEach(() => {
      sides.forEach((side, i) => {
        const was = held[i];
        if (was === undefined) Reflect.deleteProperty(dom.HTMLElement.prototype, side);
        else Object.defineProperty(dom.HTMLElement.prototype, side, was);
      });
    });

    it("the comment tool starts a thread on the item it is pressed on, or at the point", async () => {
      const invoke = vi.spyOn(host, "invoke").mockResolvedValue(wrote);
      await act(async () => {
        root.render(<CanvasPage canvasId="canvas" />);
      });
      key({ key: "m" });
      const cardA = present(container.querySelector('[data-card-id="a"] .group\\/card'), "a");
      dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 60, clientY: 60 });
      expect(panel()?.textContent).toContain("New comment");
      await write("too wide");
      expect(invoke).toHaveBeenLastCalledWith("ext.canvas.comment", {
        canvasId: "canvas",
        text: "too wide",
        on: "a",
      });
      // A comment made, the tool is select again; armed once more, a press on empty canvas comments there.
      key({ key: "m" });
      const stage = present(container.querySelector("[data-canvas-stage]"), "stage");
      dispatchPointer(stage, "pointerdown", { button: 0, clientX: 500, clientY: 400 });
      await write("room here");
      expect(invoke.mock.lastCall?.[1]).toMatchObject({ text: "room here", at: {} });
      await settle();
      expect(persistCanvasDoc).not.toHaveBeenCalled();
    });

    it("a comment kb does not take keeps its words and says why, and is sent once", async () => {
      const landing = Promise.withResolvers<Awaited<ReturnType<typeof host.invoke>>>();
      const invoke = vi.spyOn(host, "invoke").mockReturnValue(landing.promise);
      await act(async () => {
        root.render(<CanvasPage canvasId="canvas" />);
      });
      key({ key: "m" });
      const cardA = present(container.querySelector('[data-card-id="a"] .group\\/card'), "a");
      dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 60, clientY: 60 });
      await write("too wide");
      // On its way: the send is shut, so a second press writes no second thread.
      const send = present([...(panel()?.querySelectorAll("button") ?? [])].at(-1), "send");
      expect(send.disabled).toBe(true);
      await act(async () => send.click());
      expect(invoke).toHaveBeenCalledTimes(1);
      await act(async () =>
        landing.resolve({
          status: "failed",
          id: "ext.canvas.comment",
          code: "forbidden",
          message: "the store is read-only",
        }),
      );
      expect(panel()?.querySelector('[role="alert"]')?.textContent).toBe("the store is read-only");
      expect(panel()?.querySelector("textarea")?.value).toBe("too wide");
      expect(send.disabled).toBe(false);
    });

    it("from the keyboard: M, a press, words and Enter write the comment", async () => {
      const invoke = vi.spyOn(host, "invoke").mockResolvedValue(wrote);
      await act(async () => {
        root.render(<CanvasPage canvasId="canvas" />);
      });
      key({ key: "m" });
      const cardA = present(container.querySelector('[data-card-id="a"] .group\\/card'), "a");
      dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 60, clientY: 60 });
      const area = present(panel()?.querySelector("textarea"), "the panel's field");
      expect(dom.document.activeElement).toBe(area);
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")?.set?.call(
          area,
          "by keys",
        );
        area.dispatchEvent(new dom.KeyboardEvent("keyup", { bubbles: true, key: "s" }));
        area.dispatchEvent(new dom.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      });
      expect(invoke).toHaveBeenLastCalledWith("ext.canvas.comment", {
        canvasId: "canvas",
        text: "by keys",
        on: "a",
      });
    });

    it("a thread's pin opens it: its comments, a reply, and resolving it", async () => {
      host.setNodes([canvasNode, thread, reply]);
      const invoke = vi.spyOn(host, "invoke").mockResolvedValue(wrote);
      await act(async () => {
        root.render(<CanvasPage canvasId="canvas" />);
      });
      const pin = present(
        container.querySelector<HTMLButtonElement>('[data-comment-pin="t1"]'),
        "the thread's pin, on b",
      );
      act(() => pin.click());
      expect(
        [...(panel()?.querySelectorAll("[data-comment]") ?? [])].map((p) => p.textContent),
      ).toEqual(["look here", "agreed"]);
      await write("done");
      expect(invoke).toHaveBeenLastCalledWith("ext.canvas.comment", {
        canvasId: "canvas",
        text: "done",
        replyTo: "t1",
      });
      const resolve = [...(panel()?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Resolve",
      );
      await act(async () => present(resolve, "Resolve").click());
      expect(invoke).toHaveBeenLastCalledWith("node.update", {
        id: "t1",
        unsetProps: [{ field: CANVAS_IDS.commentStateField }],
        setProps: [
          {
            field: CANVAS_IDS.commentStateField,
            value: { t: "ref", v: CANVAS_IDS.commentResolved },
          },
        ],
      });
      // Its pin is drawn wherever b is: one on the canvas.
      expect(container.querySelectorAll("[data-comment-pin]")).toHaveLength(1);
    });

    it("a pin counts its comments; the list shows the open threads, and picking one opens it on what it is on", async () => {
      host.setNodes([canvasNode, thread, reply]);
      await act(async () => {
        root.render(<CanvasPage canvasId="canvas" />);
      });
      expect(container.querySelector('[data-comment-pin="t1"]')?.textContent).toBe("2");
      const toggle = present(
        container.querySelector<HTMLButtonElement>('[data-testid="comments-toggle"]'),
        "the comments switch",
      );
      expect(toggle.textContent).toBe("1");
      act(() => toggle.click());
      const entry = present(
        container.querySelector<HTMLButtonElement>('[data-comment-entry="t1"]'),
        "t1 in the list",
      );
      expect(entry.textContent).toContain("look here");
      expect(entry.textContent).toContain("1 reply");
      act(() => entry.click());
      expect(panel()?.querySelector("[data-comment-on]")?.textContent).toMatch(/^On /);
      expect(container.querySelectorAll("[data-comment-target]")).toHaveLength(1);
      // Resolved threads are the other filter's.
      const resolved = present(
        container.querySelector<HTMLButtonElement>('[aria-label="Show: Resolved"]'),
        "the resolved filter",
      );
      act(() => resolved.click());
      expect(container.querySelector('[data-comment-entry="t1"]')).toBeNull();
      expect(container.querySelector('[data-comment-pin="t1"]')).toBeNull();
    });
  });

  it("a linked item wears a link mark that says where it leads, and a click follows it", async () => {
    const linked: CanvasDoc = {
      ...initialDoc,
      nodes: initialDoc.nodes.map((item) =>
        item.id === "a" ? { ...item, link: { item: "b" } } : item,
      ),
    };
    host.setNodes([
      {
        ...canvasNode,
        props: {
          ...canvasNode.props,
          [CANVAS_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(linked) }],
        },
      },
    ]);
    const sides = ["clientWidth", "clientHeight"] as const;
    const held = sides.map((side) =>
      Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, side),
    );
    for (const side of sides) {
      Object.defineProperty(dom.HTMLElement.prototype, side, { configurable: true, value: 800 });
    }
    try {
      await act(async () => {
        root.render(<CanvasPage canvasId="canvas" />);
      });
      const marks = [...container.querySelectorAll<HTMLButtonElement>("[data-link-mark]")];
      expect(marks.map((mark) => mark.dataset.linkMark)).toEqual(["a"]);
      expect(marks[0]?.getAttribute("aria-label")).toBe("Shows b on this canvas");
      act(() => marks[0]?.click());
      expect(container.querySelector('[data-card-id="b"] [data-resize]')).not.toBeNull();
    } finally {
      sides.forEach((side, i) => {
        const was = held[i];
        if (was === undefined) Reflect.deleteProperty(dom.HTMLElement.prototype, side);
        else Object.defineProperty(dom.HTMLElement.prototype, side, was);
      });
    }
  });

  it("a modal grab follows the pointer, and a press confirms or cancels it, reaching nothing", async () => {
    await act(async () => {
      root.render(<CanvasPage canvasId="canvas" />);
    });
    const canvasStage = present(container.querySelector("[data-canvas-stage]"), "stage");
    const pointerSurface = present(canvasStage.parentElement?.parentElement, "pointer surface");
    const cardA = present(container.querySelector('[data-card-id="a"] .group\\/card'), "card a");
    dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 60, clientY: 60 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 60, clientY: 60 });
    const readout = () => container.querySelector('[data-testid="canvas-transform-readout"]');
    /** G, then the pointer 50 to the right with no button held. */
    const grab = () => {
      dispatchPointer(pointerSurface, "pointermove", { buttons: 0, clientX: 60, clientY: 60 });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "g" }));
      });
      dispatchPointer(pointerSurface, "pointermove", { buttons: 0, clientX: 110, clientY: 60 });
      expect(readout()).not.toBeNull();
    };
    const menu = () => rightClick(cardA);
    const persistedA = () =>
      persistCanvasDoc.mock.calls.at(-1)?.[1].nodes.find((node) => node.id === "a");
    const contextMenu = () => container.querySelector('[data-testid="canvas-context-menu"]');

    // The right button cancels, its context menu swallowed; so does a Ctrl-click (macOS's).
    for (const init of [{ button: 2 }, { button: 0, ctrlKey: true }]) {
      grab();
      dispatchPointer(cardA, "pointerdown", { clientX: 110, clientY: 60, ...init });
      expect(readout()).toBeNull();
      expect(menu()).toBe(true);
      expect(contextMenu()).toBeNull();
      // Swallowed once: the next is the canvas's own menu, which Escape shuts.
      expect(menu()).toBe(true);
      expect(contextMenu()).not.toBeNull();
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      });
      expect(contextMenu()).toBeNull();
      await settle();
      expect(persistCanvasDoc).not.toHaveBeenCalled();
    }

    // A plain left press confirms, and it neither selects nor carries what is under it.
    grab();
    dispatchPointer(cardA, "pointerdown", { button: 0, clientX: 110, clientY: 60 });
    dispatchPointer(pointerSurface, "pointerup", { button: 0, clientX: 110, clientY: 60 });
    expect(readout()).toBeNull();
    await settle();
    expect(persistedA()).toMatchObject({ x: 70, y: 20 });
  });
});
