/**
 * Where the canvas's context menu opens, and which of its commands apply.
 * What a menu is made of (its surface, rows and keys) is the kit's
 * (`menu.ts`, `@kb/ui-sdk`); the pieces drawn are `canvas-menu.tsx`.
 */
import { useState, type MouseEvent } from "react";
import { isTyping } from "@kb/ui-sdk";
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
    if (e.defaultPrevented || isTyping(e.target)) return;
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
