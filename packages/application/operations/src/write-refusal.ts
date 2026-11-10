/**
 * The rule a person's write is held to (DESIGN.md → Data model → write
 * protection), asked of the index: the commit asks it under
 * `systemWrites: "checked"` and fails `forbidden` with the refusal
 * (`WriteRefusal`, in `@kb/model`) as its details.
 */
import type { NodeIndex } from "@kb/query";
import { systemTxRefusal, type StoreTx, type WriteRefusal } from "@kb/model";

/**
 * A person's write to a node the index serves from a source that is not the
 * store (`NodeIndex.isVirtual`: a saved query, read from its `.edn` file),
 * refused: a stored copy would shadow the file, and the two would drift. Its
 * source is where it changes.
 */
function virtualWriteRefusal(tx: StoreTx, index: NodeIndex): WriteRefusal | null {
  const id = [...tx.upserts.map((n) => n.id), ...tx.deletes].find((each) => index.isVirtual(each));
  return id === undefined ? null : { rule: "virtual", id };
}

/**
 * Why a person may not commit `tx` over `index`, or null when they may: the
 * rule the commit runs under `systemWrites: "checked"`, a virtual node's
 * write first (`virtualWriteRefusal`), then a system node's
 * (`systemTxRefusal`). Asked ahead of a gesture whose later step would be
 * refused after its earlier ones landed, it is the same rule, not a second
 * one.
 */
export function personWriteRefusal(tx: StoreTx, index: NodeIndex): WriteRefusal | null {
  return virtualWriteRefusal(tx, index) ?? systemTxRefusal(tx, (id) => index.getNode(id));
}
