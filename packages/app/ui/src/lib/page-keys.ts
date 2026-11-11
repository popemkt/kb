/**
 * The page's own keys (DESIGN-UI.md → Keybindings): `core.page`, the key
 * context core owns, offered every key before any surface is. Its one
 * intent is the palette's: ⌘/Ctrl-K opens the anchored row's node palette
 * when an outline row anchors it (selected or edited), and the global
 * search otherwise. Any plugin may bind it a key that runs an action or a
 * command, as days binds "Go to today".
 *
 * Every key it may hold holds ⌘ or Ctrl: the rest are reserved, so a key
 * the page answers never takes typing from a field. ⌘S is left to the
 * browser, since kb has no save action to bind it to.
 */

/** Where ⌘K opens: the anchored row's node palette, or the global search. */
export type PaletteOpening = "node-palette" | "global-search";

/** Where ⌘K opens, with a row there to anchor it or none. */
export function paletteOpening(rowAnchored: boolean): PaletteOpening {
  return rowAnchored ? "node-palette" : "global-search";
}
