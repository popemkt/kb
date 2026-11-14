/**
 * A row's drag (DESIGN-UI.md → Outline editor, "A row moves anywhere"): a
 * press on its bullet that travels past its pointer's slop picks the rows
 * up, the selection's top rows when the row is one of a range, else the row
 * alone. While it lasts a ghost follows the pointer and a line shows where
 * they will land; a drop moves them there through the outline's one move
 * (`moveRows`), and Escape puts them down where they were.
 *
 * Where a drop lands is `dropOver`'s, a function of the row under the
 * pointer and nothing else, so the line drawn and the move made are one
 * answer. The ghost and the line are drawn straight to the DOM: a pointer
 * moves many times a frame, and no row renders again while it does.
 */
import {
  isQueryResultInstance,
  LONG_PRESS_MS,
  type MovePlace,
  type NodeMap,
  pastSlop,
  pointerKind,
  type PointerKind,
  selectionRoots,
  shownNodeId,
  textOr,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { outlineNodes, useOutlineStore } from "./outline.store";
import { moveRows } from "./row-moves";

/** The row under the pointer, as a drop reads it. */
export interface DropRow {
  /** The row's node. */
  readonly id: string;
  /** The node whose children it shows: a reference row's target, else the row's node. */
  readonly shownId: string;
  /** Its parent, null at the top level. */
  readonly parent: string | null;
  /** The sibling before it that stays where it is; null when there is none. */
  readonly before: string | null;
  /** Whether its children are drawn under it. */
  readonly childrenShown: boolean;
  /** Its box on screen, and where its text starts. */
  readonly box: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly textLeft: number;
  };
}

/** Where a drop lands, the line that shows it, and the row it opens to show it. */
export interface Drop {
  readonly place: MovePlace;
  readonly line: { readonly top: number; readonly left: number; readonly right: number };
  /** A row whose children the rows join first, opened when it is collapsed. */
  readonly into: string | null;
}

/**
 * The drop the pointer at (`x`, `y`) makes over `row`: above its middle,
 * before it as its sibling; below, its first child when its children are
 * drawn or the pointer is past its text start, else after it.
 */
export function dropOver(row: DropRow, x: number, y: number): Drop {
  const { box } = row;
  const line = (top: number, left: number) => ({ top, left, right: box.right });
  if (y < (box.top + box.bottom) / 2) {
    return {
      place: { parent: row.parent, after: row.before },
      line: line(box.top, box.left),
      into: null,
    };
  }
  if (row.childrenShown || x > box.textLeft) {
    return {
      place: { parent: row.shownId, after: null },
      line: line(box.bottom, box.textLeft),
      into: row.id,
    };
  }
  return {
    place: { parent: row.parent, after: row.id },
    line: line(box.bottom, box.left),
    into: null,
  };
}

/** Whether `id` is one of `moved` or under one of them, where none of them can go. */
export function underMoved(nodes: NodeMap, moved: ReadonlySet<string>, id: string): boolean {
  const seen = new Set<string>();
  for (
    let at: string | null = id;
    at !== null && !seen.has(at);
    at = nodes.get(at)?.parentId ?? null
  ) {
    if (moved.has(at)) return true;
    seen.add(at);
  }
  return false;
}

const ROW = '[data-node-row="true"]';

/** A block's own row: not a field's, nor a query's result, which stand elsewhere in the graph. */
function ownRow(row: Element): string | null {
  const key = row.getAttribute("data-instance-key");
  if (key === null || isQueryResultInstance(key)) return null;
  const block = row.closest("[data-node-block]");
  return block?.getAttribute("data-instance-key") === key ? key : null;
}

/** The row element at height `y` in the block the pointer at (`x`, `y`) is over. */
function rowElementAt(x: number, y: number): Element | null {
  const block = document.elementFromPoint(x, y)?.closest("[data-node-block]") ?? null;
  if (block === null) return null;
  const within = (el: Element) => {
    const box = el.getBoundingClientRect();
    return ownRow(el) !== null && box.top <= y && y < box.bottom;
  };
  return [...block.querySelectorAll(ROW)].find(within) ?? null;
}

/** Whether the block of `row` draws its children under it. */
function drawsChildren(row: Element): boolean {
  const block = row.closest("[data-node-block]");
  return (block?.querySelector(":scope > .children-container [data-node-block]") ?? null) !== null;
}

/** The row at height `y` under the pointer at (`x`, `y`), as a drop reads it. */
// GAP [[01M7D25CX9D6V64G19PYJJYCXM]]: a sorted frame's rows are read in graph order.
function rowAt(x: number, y: number, nodes: NodeMap, moved: ReadonlySet<string>): DropRow | null {
  const row = rowElementAt(x, y);
  const node = nodes.get(row?.getAttribute("data-node-id") ?? "");
  if (row === null || node === undefined) return null;
  const parentId = node.parentId ?? WORKSPACE_ROOT_ID;
  const siblings = nodes.get(parentId)?.children ?? [];
  const before = siblings
    .slice(0, siblings.indexOf(node.id))
    .findLast((sibling) => !moved.has(sibling));
  const box = row.getBoundingClientRect();
  const text = row.querySelector(".node-content")?.getBoundingClientRect();
  return {
    id: node.id,
    shownId: shownNodeId(node),
    parent: parentId === WORKSPACE_ROOT_ID ? null : parentId,
    before: before ?? null,
    childrenShown: !node.collapsed && drawsChildren(row),
    box: {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      textLeft: text?.left ?? box.left,
    },
  };
}

/** The element the outline scrolls in: the nearest ancestor that scrolls. */
function scrollerOf(el: Element): HTMLElement | null {
  const view = el.ownerDocument.defaultView;
  if (view === null) return null;
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = view.getComputedStyle(at);
    if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight) {
      return at;
    }
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

/** How near an edge of the scroller the pointer scrolls it, and how fast at most, px a frame. */
const EDGE = 48;
const MAX_STEP = 14;

/** How far to scroll a frame with the pointer at `y` in `top`..`bottom`. */
export function edgeStep(y: number, top: number, bottom: number): number {
  if (y < top + EDGE) return -Math.ceil((MAX_STEP * (top + EDGE - y)) / EDGE);
  if (y > bottom - EDGE) return Math.ceil((MAX_STEP * (y - (bottom - EDGE))) / EDGE);
  return 0;
}

/** What a drag picks up: the rows' nodes and the instances they run between. */
function pickedUp(nodeId: string, instanceKey: string) {
  const store = useOutlineStore.getState();
  if (store.selectedKeys.size > 1 && store.selectedKeys.has(instanceKey)) {
    const rows = store.selectedRows();
    const firstKey = rows[0]?.instanceKey ?? instanceKey;
    return {
      ids: selectionRoots(store.selectedNodeIds, outlineNodes()),
      keys: rows.map((row) => row.instanceKey),
      span: { firstKey, lastKey: rows.at(-1)?.instanceKey ?? firstKey },
    };
  }
  return {
    ids: [nodeId],
    keys: [instanceKey],
    span: { firstKey: instanceKey, lastKey: instanceKey },
  };
}

const GHOST =
  "pointer-events-none fixed top-0 left-0 z-50 flex max-w-[280px] items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 text-ui text-foreground shadow-modal";
const LINE = "pointer-events-none fixed z-50 h-0.5 -translate-y-1/2 rounded-full bg-primary";

/** The ghost of the rows picked up: the first row's text, and how many go with it. */
function ghostOf(ids: readonly string[]): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = GHOST;
  ghost.setAttribute("data-row-drag-ghost", "true");
  const text = document.createElement("span");
  text.className = "min-w-0 truncate";
  text.textContent = textOr(
    outlineNodes()
      .get(ids[0] ?? "")
      ?.text.trim(),
    "(empty)",
  );
  ghost.append(text);
  if (ids.length > 1) {
    const count = document.createElement("span");
    count.className = "shrink-0 text-caption text-muted-foreground";
    count.textContent = `+${ids.length - 1}`;
    ghost.append(count);
  }
  return ghost;
}

/** A click that is the drag's, not the page's. */
function swallow(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
}

/** Swallow the click the platform raises as the drag's pointer lifts, wherever it lands. */
function swallowNextClick(): void {
  window.addEventListener("click", swallow, { capture: true, once: true });
  // No click came (the pointer lifted off the page): nothing stays swallowed.
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

/** A press on a row's bullet, which becomes a drag once it travels past its slop. */
class RowDrag {
  private readonly kind: PointerKind;
  private readonly origin: { readonly x: number; readonly y: number };
  /** A finger held still as long as the menu waits: the press is the menu's then. */
  private held: ReturnType<typeof setTimeout> | null = null;
  private menus = false;
  private pointer: { x: number; y: number };
  private picked: ReturnType<typeof pickedUp> | null = null;
  private moved = new Set<string>();
  private ghost: HTMLElement | null = null;
  private line: HTMLElement | null = null;
  private dimmed: HTMLElement[] = [];
  private drop: Drop | null = null;
  private frame = 0;
  private scroller: HTMLElement | null = null;
  private cancelled = false;
  private readonly nodeId: string;
  private readonly instanceKey: string;

  constructor(e: React.PointerEvent<HTMLElement>, nodeId: string, instanceKey: string) {
    this.nodeId = nodeId;
    this.instanceKey = instanceKey;
    this.kind = pointerKind(e.pointerType);
    this.origin = { x: e.clientX, y: e.clientY };
    this.pointer = { x: e.clientX, y: e.clientY };
    this.scroller = scrollerOf(e.currentTarget);
  }

  /** Hear the press out: where it travels, where it lifts, and Escape. */
  listen(): void {
    if (this.kind === "touch") {
      this.held = setTimeout(() => {
        this.menus = true;
      }, LONG_PRESS_MS);
    }
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKey, true);
  }

  private readonly onMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY };
    if (this.picked === null && !this.cancelled) {
      if (!pastSlop(e.clientX - this.origin.x, e.clientY - this.origin.y, this.kind)) return;
      // A finger held still has opened the menu: the rest of its touch is the menu's.
      if (this.menus) {
        this.release();
        return;
      }
      this.pickUp();
    }
    if (this.picked !== null) this.follow();
  };

  private readonly onUp = () => {
    const { picked, drop } = this;
    if (picked !== null || this.cancelled) swallowNextClick();
    this.release();
    if (picked === null || drop === null) return;
    const store = useOutlineStore.getState();
    if (drop.into !== null && outlineNodes().get(drop.into)?.collapsed === true) {
      store.toggleCollapse(drop.into);
    }
    void moveRows(picked.ids, picked.span, drop.place, false);
  };

  private readonly onCancel = () => this.release();

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || this.picked === null) return;
    e.preventDefault();
    e.stopPropagation();
    // Put down where they were; the press is over once the pointer lifts.
    this.cancelled = true;
    this.clear();
  };

  private pickUp(): void {
    const picked = pickedUp(this.nodeId, this.instanceKey);
    this.picked = picked;
    this.moved = new Set(picked.ids);
    this.ghost = ghostOf(picked.ids);
    this.line = document.createElement("div");
    this.line.className = LINE;
    this.line.setAttribute("data-row-drop-line", "true");
    this.line.hidden = true;
    document.body.append(this.ghost, this.line);
    for (const key of picked.keys) {
      const block = document.querySelector<HTMLElement>(
        `[data-node-block][data-instance-key="${CSS.escape(key)}"]`,
      );
      if (block !== null) {
        block.style.opacity = "0.4";
        this.dimmed.push(block);
      }
    }
    document.documentElement.style.cursor = "grabbing";
    document.documentElement.style.userSelect = "none";
    this.frame = window.requestAnimationFrame(this.scroll);
  }

  /** Move the ghost to the pointer, and the line to where a drop there lands. */
  private follow(): void {
    const { x, y } = this.pointer;
    if (this.ghost !== null) this.ghost.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
    const nodes = outlineNodes();
    const row = rowAt(x, y, nodes, this.moved);
    const drop = row === null ? null : dropOver(row, x, y);
    const lands =
      drop !== null &&
      row !== null &&
      !underMoved(nodes, this.moved, row.id) &&
      (drop.place.parent === null || !underMoved(nodes, this.moved, drop.place.parent));
    this.drop = lands ? drop : null;
    if (this.line === null) return;
    this.line.hidden = !lands;
    if (!lands) return;
    Object.assign(this.line.style, {
      top: `${drop.line.top}px`,
      left: `${drop.line.left}px`,
      width: `${Math.max(0, drop.line.right - drop.line.left)}px`,
    });
  }

  /** Near the scroller's top or bottom, scroll it, and draw the drop again. */
  private readonly scroll = () => {
    if (this.picked === null) return;
    const scroller = this.scroller;
    if (scroller !== null) {
      const box =
        scroller === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight }
          : scroller.getBoundingClientRect();
      const step = edgeStep(this.pointer.y, box.top, box.bottom);
      if (step !== 0) {
        scroller.scrollTop += step;
        this.follow();
      }
    }
    this.frame = window.requestAnimationFrame(this.scroll);
  };

  /** Take down what the drag drew. */
  private clear(): void {
    window.cancelAnimationFrame(this.frame);
    this.ghost?.remove();
    this.line?.remove();
    for (const block of this.dimmed) block.style.opacity = "";
    this.dimmed = [];
    this.picked = null;
    this.drop = null;
    document.documentElement.style.cursor = "";
    document.documentElement.style.userSelect = "";
  }

  private release(): void {
    if (this.held !== null) clearTimeout(this.held);
    this.clear();
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("keydown", this.onKey, true);
  }
}

/**
 * A press on the bullet of the row at `instanceKey`, showing `nodeId`: a
 * drag once it travels, else the click it was. A modifier press is a
 * click's (it follows), and only the primary button drags.
 */
export function pressRowBullet(
  e: React.PointerEvent<HTMLElement>,
  nodeId: string,
  instanceKey: string,
): void {
  if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  new RowDrag(e, nodeId, instanceKey).listen();
}
