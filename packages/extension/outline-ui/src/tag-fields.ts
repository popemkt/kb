/**
 * A tag's field template resolved from the schema (`lib/schema.ts`): the
 * fields the tag already templates, and the existing fields it could add —
 * every field in the graph, not only those an ontology scope shows. Split out so it
 * can be exercised without a store or a live component, and so the config
 * component's module exports components only.
 */
import { descriptionOf, typeRefsOf, SYSTEM_IDS } from "@kb/model";
import type { SchemaIndex } from "@kb/ui-sdk";
import { rowName } from "@kb/ui-sdk";

export interface TagFieldRef {
  id: string;
  name: string;
  /** The field's description (`descriptionOf`), its hint where it is picked; absent when it has none. */
  hint?: string;
}

export function resolveTagFields(
  schema: SchemaIndex,
  tagId: string,
): { template: TagFieldRef[]; suggestions: TagFieldRef[]; all: TagFieldRef[] } {
  const tag = schema.get(tagId);
  const templateIds = (tag?.props[SYSTEM_IDS.fieldsField] ?? [])
    .filter((v) => v.t === "ref")
    .map((v) => v.v);

  const all: TagFieldRef[] = [];
  for (const [id, node] of schema) {
    if (typeRefsOf(node).includes(SYSTEM_IDS.field)) {
      const hint = descriptionOf(node);
      all.push({ id, name: rowName(node, schema), ...(hint === null ? {} : { hint }) });
    }
  }
  all.sort((a, b) => a.name.localeCompare(b.name));

  const byId = new Map(all.map((f) => [f.id, f]));
  return {
    // Keep the tag's own order, and still show a ref whose field node is gone.
    template: templateIds.map((id) => byId.get(id) ?? { id, name: id }),
    suggestions: all.filter((f) => !templateIds.includes(f.id)),
    all,
  };
}

/**
 * A template's field ids with `fieldId` moved to index `to` of the order it
 * leaves (clamped to its ends): what reordering a tag's fields writes. An id
 * the template does not hold moves nothing. Which fields may move is the
 * caller's: a shipped field keeps its place (`isShipped`), and moving a
 * person's field never changes the order the shipped ones keep.
 */
export function movedTemplate(ids: readonly string[], fieldId: string, to: number): string[] {
  if (!ids.includes(fieldId)) return [...ids];
  const rest = ids.filter((id) => id !== fieldId);
  const at = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, at), fieldId, ...rest.slice(at)];
}
