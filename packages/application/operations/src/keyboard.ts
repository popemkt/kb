/** Core's page keyboard definition, shared with its default graph descriptions. */
import type { ContributionEntry } from "@kb/plugin";
import { PALETTE_CHORD, type KeyContextSpec, type Keybinding } from "@kb/keybindings";
/** The page's context, as core contributes it to `ui.key-contexts`. */
const PAGE_CONTEXT: ContributionEntry<KeyContextSpec> = {
  id: "page",
  value: {
    reach: "page",
    intents: ["palette"],
    // Every chord without ⌘ or Ctrl, so a page key never types; and ⌘K, the palette's, always.
    reserved: [{ mod: false }, PALETTE_CHORD],
  },
};

/** The context's id, as bindings name it: core's namespace, then its own. */
export const PAGE_CONTEXT_ID = "core.page";

/** The page's own keys, as core contributes them to `ui.keybindings`: ⌘K. */
const PAGE_BINDINGS: readonly ContributionEntry<Keybinding>[] = [
  {
    id: "page.palette",
    value: { context: PAGE_CONTEXT_ID, chord: PALETTE_CHORD, run: { intent: "palette" } },
  },
];

export const CORE_KEYBOARD = { contexts: [PAGE_CONTEXT], bindings: PAGE_BINDINGS };
