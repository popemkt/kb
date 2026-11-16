/**
 * Contextual references: a node shown at a second place (DESIGN-UI.md →
 * Contextual references). A contextual reference is an ordinary node
 * carrying its target on the `sys.f.ref.target` ref field; the field is the
 * whole declaration, so stripping it leaves a plain node. This module is the
 * one reader of that field, isomorphic, so the page's rows and the domain's
 * readers (an export's projection) ask the same question the same way.
 */
import { SYSTEM_IDS, type NodeId } from "./model.ts";
import type { NodeLike } from "./node-like.ts";

/**
 * The node this reference points at, or null when it is not a reference.
 *
 * One read of one carrier. "Is it named `ref`?" was never on the table: a
 * user tag called `ref` must not turn its rows into references, and it
 * cannot, because nothing reads a tag name here at all.
 */
export function contextualTargetOf(node: Pick<NodeLike, "props"> | undefined): NodeId | null {
  const value = (node?.props[SYSTEM_IDS.refTargetField] ?? []).find(
    (v) => v.t === "ref" && typeof v.v === "string" && v.v !== "",
  );
  return value ? String(value.v) : null;
}

export function isContextualRef(node: Pick<NodeLike, "props"> | undefined): boolean {
  return contextualTargetOf(node) !== null;
}
