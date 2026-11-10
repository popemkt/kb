/**
 * The isomorphic node shape every reader is asked of, and the generic,
 * kind-agnostic readers over its props. They are the only place a prop is
 * decoded, so every resolution surface — ontology membership, ref-target
 * constraints, CLI receipts — reads the same bytes the same way.
 */
import { SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";

/**
 * Structural minimum both `KbNode` and `WireNode` satisfy — the reason one
 * resolver serves backend and browser.
 */
export interface NodeLike {
  readonly id: NodeId;
  readonly text: string;
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
  readonly children: readonly NodeId[];
}

/** Ref values of a multi-valued ref field, in stored order. */
export function refValuesOf(node: Pick<NodeLike, "props"> | undefined, fieldId: string): NodeId[] {
  return (node?.props[fieldId] ?? [])
    .filter((v) => v.t === "ref" && typeof v.v === "string")
    .map((v) => v.v);
}

/** First non-empty str value of a single-valued str field. */
export function strValueOf(
  node: Pick<NodeLike, "props"> | undefined,
  fieldId: string,
): string | null {
  for (const v of node?.props[fieldId] ?? []) {
    if (v.t !== "str" || typeof v.v !== "string") continue;
    const trimmed = v.v.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * TRUTH READER for the kind slot: the ids a node declares in `sys.f.type`.
 *
 * "n is tagged t", "n is a supertag", "n is a field" are all this one datum —
 * a tag node carries `sys.f.type → sys.tag`, an instance carries
 * `sys.f.type → <tag>`. Every membership / constraint / validity decision must
 * come through here.
 *
 * It is deliberately NOT the same list a UI renders as `#tag` chips: the
 * badge list drops the kind refs (`sys.tag`, `sys.field`) because a chip
 * saying "#tag" on a tag's own page would be nonsense. That is a *display*
 * rule. Reading badges back as truth is what made `sys.f.onto.include`
 * (`targetTag → sys.tag`) resolve to the empty set and the field unfillable.
 */
export function typeRefsOf(node: Pick<NodeLike, "props"> | undefined): NodeId[] {
  return refValuesOf(node, SYSTEM_IDS.typeField);
}
