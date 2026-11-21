import { declaresOptionSet } from "@kb/model";
import {
  closesCycleOf,
  nodeCandidates,
  orderCandidates,
  refUses,
  type NodeMap,
  type PickerCandidate,
  type SchemaIndex,
} from "@kb/ui-sdk";
import { recentPicks } from "./picker-recency";

/** What a candidate refused for closing a cycle is noted with. */
const WOULD_CYCLE = "would cycle";

/**
 * The targets a ref field offers, in its picker's order: its allowed ones
 * (`pool` and `allowed`, the field's `refSearchOf`), an option set in its own
 * order, and other fields' most recently picked and most used first. One
 * that would close a cycle the field declares it never holds is noted and
 * disabled, unless `selected` holds it already. What the field's picker
 * lists, and what a pasted name resolves against (`value-paste`).
 */
export function fieldTargetsOf({
  schema,
  outline,
  fieldId,
  holder,
  selected,
  pool,
  allowed,
}: {
  schema: SchemaIndex;
  outline: NodeMap;
  fieldId: string;
  holder: string | null;
  selected: ReadonlySet<string>;
  pool: NodeMap;
  allowed: Set<string> | null;
}): PickerCandidate[] {
  const fieldNode = schema.get(fieldId);
  const closes = closesCycleOf(schema, fieldId, holder);
  return orderCandidates(nodeCandidates(pool, { allowed }), {
    declared: declaresOptionSet(fieldNode) ? fieldNode?.children : undefined,
    recent: recentPicks(fieldId),
    uses: refUses(outline, fieldId),
  }).map((candidate) =>
    // Only adding is refused: a value already held stays checked and can be
    // taken back, however the cycle came to be.
    !selected.has(candidate.id) && closes(candidate.id)
      ? { ...candidate, note: WOULD_CYCLE, disabled: true }
      : candidate,
  );
}
