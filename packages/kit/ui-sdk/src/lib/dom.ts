/**
 * The DOM boundary: `EventTarget`, `Node` and `unknown` where a handler needs
 * a concrete element.
 *
 * Everything here *checks* — nothing asserts. One place decides what "this
 * event happened on an element" means, so a handler that needs `.closest()`,
 * `.blur()` or `.setPointerCapture()` states which element type it needs and
 * gets `undefined` when the target is not one.
 *
 * Node kinds are decided by `nodeType`, not by `instanceof`: the component
 * tests drive a happy-dom `Window` installed onto `globalThis` a global at a
 * time, so `Element` and `Text` are not constructors this code can name.
 */

/** `Node.ELEMENT_NODE` and `Node.TEXT_NODE`, spelled out so no realm is assumed. */
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export function isElementNode(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

export function isTextNode(node: Node): node is Text {
  return node.nodeType === TEXT_NODE;
}

/** The value, when it is an instance of `ctor`; `undefined` otherwise. */
export function asInstance<T>(
  value: unknown,
  ctor: abstract new (...args: never[]) => T,
): T | undefined {
  return value instanceof ctor ? value : undefined;
}

/** The event target as an element — `undefined` when it is not one. */
export function asElement(target: unknown): Element | undefined {
  const node = asInstance(target, Node);
  return node !== undefined && isElementNode(node) ? node : undefined;
}

/**
 * True when an event did not land inside `container`: what `useDismiss`
 * asks of a press. A missing container, or a target that is not a DOM node,
 * is outside.
 */
export function isOutside(container: Node | null | undefined, target: unknown): boolean {
  if (container === null || container === undefined) return true;
  const node = asInstance(target, Node);
  return node === undefined || !container.contains(node);
}

/**
 * The sidebar panel's marker, in the two forms the DOM needs it.
 *
 * `components/sidebar` renders the panel and `components/ui/sidebar-toggle`'s
 * caller asks whether focus is inside it before collapsing — two zones, so the
 * attribute name is written once, here, and both forms derive from it.
 */
const SIDEBAR_REGION_ATTR = "data-sidebar";
export const sidebarRegionProps = { [SIDEBAR_REGION_ATTR]: "true" } as const;
export const SIDEBAR_REGION_SELECTOR = `[${SIDEBAR_REGION_ATTR}="true"]`;

/**
 * A row's fields section: the element that holds the field values one row
 * instance draws, in drawn order. An outline row's fields section, a table
 * row's cells and a card's fields each carry it, so the keyboard's path
 * through a row's values (outline-ui's `value-slot-nav`) reads every surface
 * that draws them. It names the node whose values they are and the row
 * instance that draws them.
 */
const FIELDS_FOR_ATTR = "data-fields-for";
const FIELDS_OF_ATTR = "data-fields-of";
export function fieldsSectionProps(
  nodeId: string,
  instanceKey: string | undefined,
): Readonly<Record<string, string | undefined>> {
  return { [FIELDS_FOR_ATTR]: nodeId, [FIELDS_OF_ATTR]: instanceKey };
}
/** Any row's fields section. */
export const FIELDS_SECTION_SELECTOR = `[${FIELDS_FOR_ATTR}]`;
/** The fields sections of node `nodeId`, wherever it is drawn. */
export function fieldsSectionForSelector(nodeId: string): string {
  return `[${FIELDS_FOR_ATTR}="${CSS.escape(nodeId)}"]`;
}
/** The fields section row instance `instanceKey` draws. */
export function fieldsSectionOfSelector(instanceKey: string): string {
  return `[${FIELDS_OF_ATTR}="${CSS.escape(instanceKey)}"]`;
}

/**
 * True when an event landed in a text-entry surface. Every hotkey handler that
 * declines to act "while the user is typing" asks exactly this question.
 */
export function isTextEntry(target: unknown): boolean {
  const el = asInstance(target, HTMLElement);
  if (el === undefined) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

/**
 * True when a pointer landed in the text entry that has the focus: words
 * being typed, whose own gestures (the caret, a selection, the browser's
 * menu) are the browser's. A pointer may land in an entry nothing is typed
 * into yet (a canvas text card's), which is a surface like any other.
 */
export function isTyping(target: unknown): boolean {
  return isTextEntry(target) && target === document.activeElement;
}
