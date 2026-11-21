/**
 * References opened in place (DESIGN-UI.md → Contextual references, "A
 * reference in the text opens in place"): which of the references a row's
 * text names are open under it, and where that choice is held. It is the
 * reader's, in the outline's open references (`openReferences`), each under
 * the key of the projected row the open reference draws. A row's own open or
 * closed choice is held apart, in its expansion, so the row an open
 * reference draws keeps a choice of its own under the same key.
 */
import { extractMentions, type NodeId } from "@kb/model";
import { isProjectedInstance, projectedRowKey, projectedRowOf, type SchemaIndex } from "@kb/ui-sdk";

/** The key of the reference to `targetId` in the text of `sourceId`: its projected row's. */
export const openReferenceKey = projectedRowKey;

/** The references `text` names, each once, in the order it first names them. */
export function referencesIn(text: string): NodeId[] {
  return [...new Set(extractMentions(text))];
}

/**
 * The references the text of `sourceId` names that are open under its row in
 * the outline of host `host`, in text order.
 */
export function openReferencesOf(
  open: ReadonlySet<string>,
  host: string,
  sourceId: string,
  text: string,
): NodeId[] {
  return referencesIn(text).filter((id) => open.has(openReferenceKey(host, sourceId, id)));
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

/** Whether open reference `key` still holds: its row's text still names it. */
export function openReferenceHolds(key: string, schema: SchemaIndex): boolean {
  const row = projectedRowOf(key);
  return row !== null && extractMentions(schema.get(row.sourceId)?.text ?? "").includes(row.nodeId);
}
