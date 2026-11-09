/** Global keyboard shortcut dispatch (DESIGN-RESKIN W8 feel). */
import { matchesChord, PALETTE_CHORD } from "@kb/ui-sdk";

export type GlobalShortcutAction = "global-search" | "node-palette";

/**
 * The global action a key chord means, or null to leave it to the page.
 *
 * ⌘/Ctrl-K is one key with two meanings, and which one is decided here, not
 * at the call site: with an outline row to anchor to (selected or being
 * edited) it opens that node's palette, otherwise the global search. ⌘S is
 * deliberately left to the browser — kb has no save action to bind it to.
 * The outline's contexts reserve ⌘K (`PALETTE_CHORD`); the page's own keys
 * are a function rather than a context of `ui.keybindings`:
 * GAP [[01M6Y9H6R5D9Y8TQKZJZVWX8PB]].
 */
export function matchGlobalShortcut(
  e: { metaKey: boolean; ctrlKey: boolean; key: string },
  context: { rowAnchored: boolean },
): GlobalShortcutAction | null {
  if (!matchesChord(e, PALETTE_CHORD)) return null;
  return context.rowAnchored ? "node-palette" : "global-search";
}
