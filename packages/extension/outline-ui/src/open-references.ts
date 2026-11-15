/**
 * References opened in place (DESIGN-UI.md → Contextual references, "A
 * reference in the text opens in place"): which of the references a row's
 * text names are open under it, and where that choice is held. It is the
 * reader's, in the outline's expansion beside each row's open or closed
 * choice, under the key of the projected row the open reference draws.
 */
import { extractMentions, type NodeId } from "@kb/model";
import {
  type Expansion,
  isProjectedInstance,
  projectedRowKey,
  projectedRowOf,
  type SchemaIndex,
} from "@kb/ui-sdk";

/** The expansion key of the reference to `targetId` in the text of `sourceId`: its projected row's. */
export const openReferenceKey = projectedRowKey;

/** Whether expansion key `key` is a reference's, not a row's. */
export function isReferenceKey(key: string): boolean {
  return projectedRowOf(key) !== null;
}

/** The references `text` names, each once, in the order it first names them. */
export function referencesIn(text: string): NodeId[] {
  return [...new Set(extractMentions(text))];
}

/** The references the text of `sourceId` names that are open under its row, in text order. */
export function openReferencesOf(expansion: Expansion, sourceId: string, text: string): NodeId[] {
  return referencesIn(text).filter((id) => expansion.get(openReferenceKey(sourceId, id)) === true);
}

/**
 * Whether a row drawn at `instanceKey` opens references in place: a row of
 * the outline's own tree does. A projected row, and every row inside one,
 * follows instead, so two references that name each other cannot open into
 * each other forever.
 */
export function opensInPlace(instanceKey: string): boolean {
  return !isProjectedInstance(instanceKey);
}

/**
 * Whether expansion key `key` is an open reference, and whether it still
 * holds: its row's text still names it. Null for a key that is a row's.
 */
export function openReferenceHolds(
  key: string,
  open: boolean,
  schema: SchemaIndex,
): boolean | null {
  const row = projectedRowOf(key);
  if (row === null) return null;
  return open && extractMentions(schema.get(row.sourceId)?.text ?? "").includes(row.nodeId);
}
