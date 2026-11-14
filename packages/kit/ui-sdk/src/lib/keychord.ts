/**
 * The page's one keyboard boundary: a browser press becomes the shared chord
 * model's event (`@kb/keybindings`) here, once.
 */
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
