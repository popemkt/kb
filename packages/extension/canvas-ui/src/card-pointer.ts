import { asElement } from "@kb/ui-sdk";

/**
 * What a pointerdown on a canvas card means.
 *
 * - `chrome` — it landed on a port or a resize handle; that control owns it.
 * - `edit` — it landed in the card's own inner editor; select, do not drag.
 * - `drag` — anywhere else on the card.
 */
export type CardPointerIntent = "chrome" | "edit" | "drag";

/** Ports and resize handles are card chrome on every card kind. */
const CHROME_SELECTOR = "[data-port],[data-resize]";

/**
 * `innerEditor` is the CSS selector for this card kind's editor while it is
 * open — the outline row, the textarea, the label input — or `undefined`
 * for a card that has none or whose editor is closed: a closed editor takes
 * no press, so a press on the words carries the card as one on its edge
 * does. It is the only thing that differs between card kinds.
 */
export function classifyCardPointer(
  target: unknown,
  innerEditor: string | undefined,
): CardPointerIntent {
  const el = asElement(target);
  if (el === undefined) return "drag";
  if (el.closest(CHROME_SELECTOR) !== null) return "chrome";
  if (innerEditor !== undefined && el.closest(innerEditor) !== null) return "edit";
  return "drag";
}

/**
 * A press on a card's body, which every card kind with words makes alike:
 * its chrome's own, its open editor's (the card is selected and the editor
 * keeps the press), or else the card's, which it selects and carries.
 */
export function pressCardBody<
  E extends { readonly target: EventTarget | null; stopPropagation(): void },
>(e: E, openEditor: string | undefined, onSelect: () => void, onMoveStart: (e: E) => void): void {
  const intent = classifyCardPointer(e.target, openEditor);
  if (intent === "chrome") return;
  if (intent === "drag") e.stopPropagation();
  onSelect();
  if (intent === "drag") onMoveStart(e);
}

/** The id of the item a DOM event landed on, in the 2D stage. */
export function cardIdAt(target: EventTarget | null): string | undefined {
  return asElement(target)?.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
}

/** The id of the edge a DOM event landed on, in the 2D stage. */
export function edgeIdAt(target: EventTarget | null): string | undefined {
  return asElement(target)?.closest<SVGElement>("[data-edge-id]")?.dataset.edgeId;
}
