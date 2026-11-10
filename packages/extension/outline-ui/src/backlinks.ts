import { isSysPrefixed, relationInverseOf, type KbNode } from "@kb/model";
import {
  type EdnRunner,
  type NodeIndex,
  queryBacklinks,
  rowText,
  type SchemaIndex,
  type TagBadge,
} from "@kb/ui-sdk";

/**
 * A typed relation the referrer holds to the node, worded from the node's
 * side: the field's inverse label when it names one ("influenced by"),
 * else its own label read toward the node ("influences →").
 */
interface BacklinkRelation {
  field: string;
  label: string;
}

export interface BacklinkRow {
  id: string;
  text: string;
  tags: TagBadge[];
  /**
   * The fields the referrer points here through, whichever carrier reads
   * them: a ref value, a `[[id]]` token in a text value, a date for its
   * day. None when it only mentions the node in its own text.
   */
  relations: BacklinkRelation[];
}

/** Where a referrer's references are read, field by field (`NodeIndex.referenceFields`). */
type ReferenceReader = Pick<NodeIndex, "getNode" | "referenceFields">;

/**
 * Nodes that reference `nodeId`, resolved to rows ready to render.
 *
 * The query itself belongs to the query seam (`@kb/ui-sdk`) — one owner for "what references X" — and
 * this is the layer above it that the References section consumes, so the seam
 * keeps one set of callers instead of gaining a component. Which fields a
 * reference comes through is the index's answer (`references`), read by the
 * same carriers that made the reference, so a row never shows a reference
 * without saying where it is.
 *
 * Text comes from the referring node, read from the schema so a referrer
 * outside the current scope is still named, under the same display rule as an
 * outline row: a referrer whose own text is empty is a contextual reference,
 * and would otherwise render as a blank line.
 */
export function backlinkRows(
  run: EdnRunner,
  schema: SchemaIndex,
  references: ReferenceReader | null,
  nodeId: string,
): BacklinkRow[] {
  return queryBacklinks(run, nodeId)
    .filter((b) => b.id !== nodeId)
    .map((b) => {
      // The referrer's own text is schema-level too: a referrer outside the
      // scope is still a node, and a contextual one shows its target's text.
      const node = schema.get(b.id);
      const referrer = references?.getNode(b.id);
      return {
        id: b.id,
        text: node ? rowText(node, schema) : b.text,
        tags: node?.tags ?? [],
        relations:
          referrer === undefined || references === null
            ? []
            : relationsThrough(referrer, references.referenceFields(referrer, nodeId), schema),
      };
    });
}

/**
 * The relations `referrer` holds through `fields`, in its prop order, each
 * labelled as {@link BacklinkRelation} says. A system field (a tag, a view)
 * is scaffolding, not a relation a person named.
 */
function relationsThrough(
  referrer: KbNode,
  fields: ReadonlySet<string>,
  schema: SchemaIndex,
): BacklinkRelation[] {
  return Object.keys(referrer.props).flatMap((field) => {
    if (isSysPrefixed(field) || !fields.has(field)) return [];
    const fieldNode = schema.get(field);
    const inverse = relationInverseOf(fieldNode);
    return [{ field, label: inverse ?? `${fieldNode?.text ?? field} →` }];
  });
}
