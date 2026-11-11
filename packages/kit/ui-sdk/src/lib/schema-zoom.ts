/**
 * Schema-page live queries for zoomed tag / field nodes (DESIGN-REFINE §2 W3).
 */
import type { EdnRunner } from "../query";
import { SYSTEM_IDS, type OutlineNode } from "./types";

export type SchemaZoomKind = "tag" | "field" | null;

/**
 * The schema kind a type names: a node typed `sys.tag` is a tag, one typed
 * `sys.field` a field, and the kind is what a person calls it, never its id.
 */
export function kindOfType(typeId: string): SchemaZoomKind {
  if (typeId === SYSTEM_IDS.tag) return "tag";
  if (typeId === SYSTEM_IDS.field) return "field";
  return null;
}

export function schemaZoomKind(node: OutlineNode | undefined): SchemaZoomKind {
  const kinds = new Set(
    (node?.props[SYSTEM_IDS.typeField] ?? []).map((v) => (v.t === "ref" ? kindOfType(v.v) : null)),
  );
  // A tag that is also a field is shown as the tag it is.
  if (kinds.has("tag")) return "tag";
  return kinds.has("field") ? "field" : null;
}

export interface SchemaHit {
  id: string;
  text: string;
}

/** EDN for "everything whose `sys.f.type` is this tag node". */
export function taggedInstancesQuery(tagId: string): string {
  return `[:find ?id ?text
      :where [?n :f/${SYSTEM_IDS.typeField} ?t]
             [?t :node/id "${tagId}"]
             [?n :node/id ?id]
             [?n :node/text ?text]]`;
}

/** Nodes that carry `fieldId` as a prop key. */
export function fieldCarriersQuery(fieldId: string): string {
  return `[:find ?id ?text
      :where [?n :f/${fieldId} _]
             [?n :node/id ?id]
             [?n :node/text ?text]]`;
}

/** Everything tagged with this tag node (Tana schema page). */
export function queryTaggedInstances(run: EdnRunner, tagId: string): SchemaHit[] {
  return rowsToHits(run(taggedInstancesQuery(tagId))).filter((h) => h.id !== tagId);
}

/** Nodes that carry this field as a prop key. */
export function queryFieldCarriers(run: EdnRunner, fieldId: string): SchemaHit[] {
  return rowsToHits(run(fieldCarriersQuery(fieldId))).filter((h) => h.id !== fieldId);
}

function rowsToHits(rows: unknown[][]): SchemaHit[] {
  const hits: SchemaHit[] = [];
  for (const row of rows) {
    const id = row[0];
    const text = row[1];
    if (typeof id !== "string") continue;
    hits.push({
      id,
      text: typeof text === "string" ? text : id,
    });
  }
  hits.sort((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
  return hits;
}
