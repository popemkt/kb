/**
 * The page-head backdrop's one gesture (DESIGN-UI.md → Page-head backdrops
 * → Its actions): a double-click on the backdrop's own area opens its
 * actions. The frame is `pointer-events: none` and painted behind the
 * page, so the double-click is heard on the document and is the backdrop's
 * only where it lands within what covers the frame (`coveringAncestor`, as
 * the pointer's is, resolved when the double-click lands, since the layout
 * may have moved since the frame mounted), over the frame, and where the
 * page has no use for it:
 *
 * - not on anything editable, a control, a link or a label;
 * - not one that selected the text under the pointer (a double-click
 *   selects a word before `dblclick` fires). A browser double-clicked in
 *   empty space may select the nearest word, beside the pointer, not
 *   under it: that one is still the backdrop's, and the word it selected
 *   is let go. A selection that stood before the double-click began (its
 *   first press) is the person's, and stays;
 * - not one the page already handled (`defaultPrevented`).
 *
 * The listener is passive in effect: it never takes the default, so a
 * double-click meant for the page does what it did before.
 */
import { coveringAncestor, placeOver } from "./pointer-over.ts";

/** What takes a double-click of its own: the page's, never the backdrop's. */
const PAGE_TAKES =
  'input, textarea, select, button, a[href], label, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="textbox"], [role="slider"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"]';

function isBackdrops(event: MouseEvent, frame: HTMLElement): boolean {
  if (event.defaultPrevented) return false;
  const target = event.target;
  if (!(target instanceof Node)) return false;
  // A text node, or a drawing's own element, answers by the element it is in.
  const element = target instanceof HTMLElement ? target : target.parentElement;
  if (element === null || element.closest(PAGE_TAKES) !== null) return false;
  if (!coveringAncestor(frame).contains(element)) return false;
  const at = { x: event.clientX, y: event.clientY };
  if (selectedUnder(frame.ownerDocument.getSelection(), at)) return false;
  return placeOver(frame.getBoundingClientRect(), at) !== null;
}

/** Whether `selection` holds text whose box is under the point `at`. */
function selectedUnder(selection: Selection | null, at: { x: number; y: number }): boolean {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return false;
  return [...selection.getRangeAt(0).getClientRects()].some((box) => placeOver(box, at) !== null);
}

/** Where `selection` stands: its first range's ends, or null where it holds no text. */
function standing(selection: Selection | null): readonly unknown[] | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const { startContainer, startOffset, endContainer, endOffset } = selection.getRangeAt(0);
  return [startContainer, startOffset, endContainer, endOffset];
}

const sameStanding = (a: readonly unknown[] | null, b: readonly unknown[] | null): boolean =>
  a === b || (a !== null && b !== null && a.every((end, i) => end === b[i]));

/**
 * Call `onDouble` for each double-click over `frame` that is the
 * backdrop's, until stopped; a selection the double-click made on its way
 * (one that was not there at its first press) is let go.
 */
export function watchBackdropDoubleClick(frame: HTMLElement, onDouble: () => void): () => void {
  const page = frame.ownerDocument;
  let before: readonly unknown[] | null = null;
  // Heard in the capture phase, before the browser's default changes the selection for this press.
  const pressed = (event: MouseEvent) => {
    if (event.detail <= 1) before = standing(page.getSelection());
  };
  const heard = (event: MouseEvent) => {
    if (!isBackdrops(event, frame)) return;
    const selection = page.getSelection();
    if (!sameStanding(standing(selection), before)) selection?.removeAllRanges();
    onDouble();
  };
  page.addEventListener("mousedown", pressed, { capture: true, passive: true });
  page.addEventListener("dblclick", heard, { passive: true });
  return () => {
    page.removeEventListener("mousedown", pressed, { capture: true });
    page.removeEventListener("dblclick", heard);
  };
}
