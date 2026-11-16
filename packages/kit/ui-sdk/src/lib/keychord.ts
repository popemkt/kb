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

/** WebKit's keyCode for a key the IME handled. */
const IME_KEY_CODE = 229;

/**
 * Whether a press belongs to an IME composition, and so is never a command
 * (DESIGN-UI.md → "IME composition is never interrupted"). That is every key
 * while one is open (`composing`, the surface's `compositionstart`/`end`
 * flag, or the event's own `isComposing`), and the key that ends one, which
 * WebKit sends after `compositionend` with keyCode 229: Enter that commits a
 * Vietnamese or CJK word commits it and does nothing more.
 */
export function isCompositionKey(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
  composing = false,
): boolean {
  return (
    composing ||
    event.isComposing ||
    // oxlint-disable-next-line typescript/no-deprecated -- WebKit marks the key that ends a composition only by keyCode 229; no current property carries it
    event.keyCode === IME_KEY_CODE
  );
}
