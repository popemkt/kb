/**
 * Where a node is shown, by the instance a person acts on it through: a row,
 * or a page's title. The node menu opens there (`menuAnchorOf`), whichever it is.
 */
export function menuAnchor(instanceKey: string): { "data-menu-anchor": string } {
  return { "data-menu-anchor": instanceKey };
}

/** The element instance `instanceKey` is shown by, for the node menu to open at. */
export function menuAnchorOf(instanceKey: string): HTMLElement | null {
  const found = document.querySelector(`[data-menu-anchor="${CSS.escape(instanceKey)}"]`);
  return found instanceof HTMLElement ? found : null;
}
