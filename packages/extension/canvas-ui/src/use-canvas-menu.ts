/**
 * What every canvas menu is made of (the view menu, the context menu): its
 * surface, its row, and its keys — the arrows, Home and End move through
 * its rows, and none of them reaches the canvas's own keys (nudge, escape)
 * while it is open — and where the context menu opens. Dismissal is
 * `useDismiss`'s, as every popover's; the pieces drawn are `canvas-menu.tsx`.
 */
import { useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { cn, isTextEntry } from "@kb/ui-sdk";
import { cardIdAt, edgeIdAt } from "./card-pointer";
import { isGroupNode, itemLead, type CanvasNode } from "@kb/canvas";
import {
  menuRows,
  type CanvasIntent,
  type CanvasMenuCommand,
  type CanvasMenuName,
} from "./canvas-keymap";
import { hasEditor } from "./canvas-face-overlay";
import { selectForMenu, selectionEmpty, soleItem, type CanvasSelection } from "./canvas-selection";

/** A menu's look: a floating surface over the stage. */
export const MENU_SURFACE =
  "kb-surface-enter z-30 w-56 rounded-lg border border-foreground/10 bg-popover p-1 text-ui text-popover-foreground shadow-overlay";

/** A menu row's look. */
export const MENU_ROW = cn(
  "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left outline-none",
  "hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] disabled:opacity-40",
);

/** A menu's element and what its keys do. */
interface MenuKeys {
  ref: RefObject<HTMLDivElement | null>;
  onKeyDown: (e: KeyboardEvent) => void;
}

/** A menu's element and its keys: the arrows, Home and End move the focus through its enabled rows. */
export function useMenuKeys(): MenuKeys {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const all = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)") ??
        []),
    ];
    const at = all.findIndex((item) => item === document.activeElement);
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step !== 0) all[(at + step + all.length) % all.length]?.focus();
    else if (e.key === "Home") all[0]?.focus();
    else if (e.key === "End") all.at(-1)?.focus();
    else return;
    // The canvas's own keys (nudge, escape) stay out of an open menu.
    e.preventDefault();
    e.stopPropagation();
  };
  return { ref, onKeyDown };
}

interface Spot {
  readonly x: number;
  readonly y: number;
}

/**
 * The context menu's opening: a right-click on the 2D stage selects what
 * it lands on (`selectForMenu`) and opens the menu where it was made, over
 * the element that heard it. A menu already swallowed opens nothing: the
 * press that ends a modal transform swallows its own (`onModalPress`); and
 * one over words being typed is the browser's.
 */
export function useCanvasContextMenu(
  selection: CanvasSelection,
  setSelection: (selection: CanvasSelection) => void,
): { at: Spot | null; open: (e: MouseEvent<HTMLElement>) => void; close: () => void } {
  const [at, setAt] = useState<Spot | null>(null);
  const open = (e: MouseEvent<HTMLElement>) => {
    // Words being typed keep the browser's menu: spelling, paste, look up.
    if (e.defaultPrevented || isTextEntry(e.target)) return;
    e.preventDefault();
    setSelection(selectForMenu(selection, { node: cardIdAt(e.target), edge: edgeIdAt(e.target) }));
    const box = e.currentTarget.getBoundingClientRect();
    setAt({ x: e.clientX - box.left, y: e.clientY - box.top });
  };
  return { at, open, close: () => setAt(null) };
}

/**
 * Whether `intent` has anything to act on in `selection`: ↵ an editor, ⌘↵
 * a link, ungroup a frame, framing the selection a selection.
 */
export function intentApplies(
  intent: CanvasIntent,
  selection: CanvasSelection,
  byId: ReadonlyMap<string, CanvasNode>,
): boolean {
  const sole = soleItem(selection, byId);
  if (intent.type === "edit") return sole !== undefined && hasEditor(sole);
  if (intent.type === "followLink") return sole !== undefined && itemLead(sole) !== undefined;
  if (intent.type === "frame" && intent.scope === "selection") return !selectionEmpty(selection);
  if (intent.type === "ungroup") {
    return [...selection.nodeIds].some((id) => {
      const item = byId.get(id);
      return item !== undefined && isGroupNode(item);
    });
  }
  return true;
}

/** Menu `menu`'s rows (`menuRows`), each command with nothing to act on in `selection` left out. */
export function menuCommands(
  menu: CanvasMenuName,
  selection: CanvasSelection,
  byId: ReadonlyMap<string, CanvasNode>,
): readonly (readonly CanvasMenuCommand[])[] {
  return menuRows(menu)
    .map((row) => row.filter((command) => intentApplies(command.intent, selection, byId)))
    .filter((row) => row.length > 0);
}
