/**
 * Field values in the outline's keyboard path.
 *
 * A node's field values sit between its text and its children, so the
 * outline's arrows pass through them: ↓ from a row's last line lands on its
 * first value, ↓ from its last value lands on the next row, and ↑ comes back
 * the same way. The order is the order they are drawn in — a row's values
 * are the `[data-value-slot]` elements of its own fields section — so this
 * reads it off the DOM rather than keeping a second list of the same thing.
 *
 * A slot registers a control on its element (`registerSlot`), so a
 * neighbour can be opened for editing, not only focused, when the keyboard
 * arrives on it (Backspace on an empty value lands at the end of the one
 * before).
 */
import { asInstance } from "@kb/ui-sdk";

/** What another slot, or a row, may ask of a value slot. */
export interface SlotControl {
  /** Take the focus, at rest: the slot is selected, its editor closed. */
  focus: () => void;
  /** Open the editor with the caret at the end of the value. */
  editAtEnd: () => void;
}

const controls = new WeakMap<Element, SlotControl>();

export function registerSlot(el: Element, control: SlotControl): () => void {
  controls.set(el, control);
  return () => {
    if (controls.get(el) === control) controls.delete(el);
  };
}

const SLOT = "[data-value-slot]";

/** The value slots of the fields section a slot sits in, in drawn order. */
function sectionSlots(slot: Element): HTMLElement[] {
  const section = slot.closest("[data-fields-for]");
  if (section === null) return [];
  return [...section.querySelectorAll(SLOT)].flatMap((el) => {
    const html = asInstance(el, HTMLElement);
    return html === undefined ? [] : [html];
  });
}

/** Where a slot sits among its section's values, or -1. */
export function slotIndex(slot: Element): number {
  return sectionSlots(slot).findIndex((el) => el === slot);
}

/** The slot at `index` in the fields section `section`, or null. */
export function slotAt(section: Element, index: number): HTMLElement | null {
  const first = section.querySelector(SLOT);
  return first === null ? null : (sectionSlots(first)[index] ?? null);
}

/** The first value slot of field `fieldId`'s row in the fields section `section`, or null. */
export function fieldSlot(section: Element, fieldId: string): HTMLElement | null {
  const row = section.querySelector(`[data-field="${CSS.escape(fieldId)}"]`);
  const slot = row?.querySelector(SLOT);
  return slot === null || slot === undefined ? null : (asInstance(slot, HTMLElement) ?? null);
}

/** The slot `delta` places from `slot` in its section, or null past either end. */
export function neighbourSlot(slot: Element, delta: -1 | 1): HTMLElement | null {
  const slots = sectionSlots(slot);
  const at = slots.findIndex((el) => el === slot);
  return at === -1 ? null : (slots[at + delta] ?? null);
}

/**
 * The value slots of one row instance in the outline: its own fields
 * section's, never a descendant row's.
 */
function instanceSlots(instanceKey: string, root: ParentNode = document): HTMLElement[] {
  const block = root.querySelector(
    `[data-node-block][data-instance-key="${CSS.escape(instanceKey)}"]`,
  );
  const section = block?.querySelector(":scope > .children-container > [data-fields-for]");
  if (section === null || section === undefined) return [];
  const first = section.querySelector(SLOT);
  return first === null ? [] : sectionSlots(first);
}

/** Put the keyboard on a slot: at rest, or with its editor open at the end. */
export function arriveAt(slot: Element, how: "rest" | "edit"): void {
  const control = controls.get(slot);
  if (control === undefined) return;
  if (how === "edit") control.editAtEnd();
  else control.focus();
}

/**
 * Put the keyboard on a row's first or last field value, at rest. False when
 * the row shows no values, so the caller moves on to the next row instead.
 */
export function enterFields(instanceKey: string, which: "first" | "last"): boolean {
  const slots = instanceSlots(instanceKey);
  const slot = which === "first" ? slots[0] : slots.at(-1);
  if (slot === undefined) return false;
  arriveAt(slot, "rest");
  return true;
}

/**
 * Land on node `nodeId`'s last field value where its fields are drawn nearest
 * row instance `instanceKey`, at rest, once the page has drawn the write that
 * follows: under its row, or in the page head when it is the page. The row's
 * place is read now, since that write may take the row away.
 */
export function landInFieldsOf(instanceKey: string, nodeId: string): () => void {
  const row = document.querySelector(
    `[data-node-block][data-instance-key="${CSS.escape(instanceKey)}"]`,
  );
  const around: Element[] = [];
  for (let at = row?.parentElement ?? null; at !== null; at = at.parentElement) around.push(at);
  const sectionOf = `[data-fields-for="${CSS.escape(nodeId)}"]`;
  const land = () => {
    const section = around
      .find((el) => el.isConnected && el.querySelector(sectionOf) !== null)
      ?.querySelector(sectionOf);
    const first = section?.querySelector(SLOT);
    const slot = first === null || first === undefined ? undefined : sectionSlots(first).at(-1);
    if (slot !== undefined) arriveAt(slot, "rest");
  };
  return () => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(land);
    else land();
  };
}

/** How many field values a row instance shows. */
export function fieldSlotCount(instanceKey: string): number {
  return instanceSlots(instanceKey).length;
}
