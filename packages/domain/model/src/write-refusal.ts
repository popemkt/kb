/**
 * Why the commit refuses a person's write (DESIGN.md → Data model → write
 * protection), as data: the node it is refused for and the part of the rule
 * the write breaks. Each surface words it from this
 * ({@link writeRefusalMessage} for an agent or a command line, the page for
 * a person), so the reason is stated once and read by each.
 *
 * A system node's write (`systemTxRefusal`, in system-write.ts):
 * - `mint`: `id` is a system id the graph does not hold, which only its
 *   owner's seed makes.
 * - `rank`, `stamp`: the node keeps the rank and the creation stamp its owner
 *   gave it.
 * - `children`: its children keep what its owner seeded, in their order.
 * - `list`: the values of `field`, one of its additive lists
 *   (`ADDITIVE_FIELDS`), keep what its owner seeded, in their order.
 * - `setting`: `field` is not a setting of the node, so its values on it are
 *   its owner's.
 * - `delete`: deleting a system node is its owner's.
 *
 * And `virtual`: the index serves the node from a source that is not the
 * store (a saved query's `.edn`), which is where it changes
 * (`personWriteRefusal` in `@kb/operations`, which asks the index).
 *
 * Schemas, because the refusal travels: the commit's `forbidden` failure
 * carries it as its details, and a surface reads it back from a receipt
 * ({@link writeRefusalOf}).
 */
import { Schema } from "effect";

export const SystemRefusalSchema = Schema.Union([
  Schema.Struct({
    rule: Schema.Literals(["mint", "rank", "stamp", "children", "delete"]),
    id: Schema.String,
  }),
  Schema.Struct({
    rule: Schema.Literals(["list", "setting"]),
    id: Schema.String,
    field: Schema.String,
  }),
]);
export type SystemRefusal = typeof SystemRefusalSchema.Type;

export const WriteRefusalSchema = Schema.Union([
  SystemRefusalSchema,
  Schema.Struct({ rule: Schema.Literal("virtual"), id: Schema.String }),
]);
export type WriteRefusal = typeof WriteRefusalSchema.Type;

const isWriteRefusal = Schema.is(WriteRefusalSchema);

/** A refusal of a system node's write: what is its owner's, and how its owner overrides. */
const refused = (sentence: string) => `${sentence} (use force to override)`;

/** What a refused list keeps, and what a person may do with it. */
const KEEPS = "its owner seeded, in their order: a person's may be added, moved or removed";

/** `refusal` as a sentence for an agent or a command line: what is kept, and the override. */
export function writeRefusalMessage(refusal: WriteRefusal): string {
  const { id } = refusal;
  switch (refusal.rule) {
    case "virtual":
      return `${id} is read from its source file, not the store; change it there`;
    case "mint":
      return refused(`${id} is a system id, which only its owner's seed mints`);
    case "rank":
      return refused(`${id} keeps the rank its owner gave it`);
    case "stamp":
      return refused(`${id} keeps its creation stamp`);
    case "children":
      return refused(`${id} keeps the children ${KEEPS}`);
    case "list":
      return refused(`${id} keeps the ${refusal.field} values ${KEEPS}`);
    case "setting":
      return refused(`${refusal.field} on ${id} is its owner's to write`);
    case "delete":
    default:
      return refused(`${id} is its owner's to delete`);
  }
}

/** The refusal a `forbidden` failure's `details` carry, or null when they carry none. */
export function writeRefusalOf(details: unknown): WriteRefusal | null {
  return isWriteRefusal(details) ? details : null;
}
