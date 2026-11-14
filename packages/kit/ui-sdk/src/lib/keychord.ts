/** Browser callers use the shared chord model. */
export {
  chordsOverlap,
  isPrintableKey,
  lookupChord,
  matchesChord,
  printableExcept,
  PALETTE_CHORD,
  TEXT_HISTORY_CHORD,
  type Chord,
  type KeyChordEvent,
} from "@kb/keybindings";

import type { KeyChordEvent } from "@kb/keybindings";

/** Translate a browser press once at the page/surface keyboard boundary. */
export function keyChordEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): KeyChordEvent {
  return {
    key: event.key,
    physicalKey: event.code,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  };
}
