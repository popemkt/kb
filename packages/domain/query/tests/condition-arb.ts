/**
 * Generators of the condition model (`ir/conditions.ts`): a person's tree as
 * the builder would hold it, groups and empty ones included, over a small
 * vocabulary of fields and nodes so rows meet and merge, and wide values
 * (every string, every finite number) so the printer's round trip is
 * exercised through them.
 */
import fc from "fast-check";
import type { CompareOp, Condition, ConditionEdge, ConditionValue } from "@kb/query";

/** Field ids that are EDN keywords after `:f/`; `sys.f.type` is the one `has tag` is. */
const FIELDS = ["status", "due", "est", "note", "owner", "sys.f.type"] as const;

const field = fc.constantFrom(...FIELDS);
const nodeId = fc.oneof(fc.constantFrom("a", "b", "tag.todo", "s.doing"), fc.string());
const text = fc.oneof(fc.constantFrom("draft", "Doing", ""), fc.string());
const number = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0)),
);

/** Labels that read as a number or a boolean too, beside any text. */
const label = fc.oneof(fc.constantFrom("3", "true", "false", "0", "1e+21", "Doing"), fc.string());

const valueArb: fc.Arbitrary<ConditionValue> = fc.oneof(
  nodeId.map((v) => ({ t: "ref" as const, v })),
  text.map((v) => ({ t: "str" as const, v })),
  number.map((v) => ({ t: "num" as const, v })),
  fc.boolean().map((v) => ({ t: "bool" as const, v })),
  label.map((v) => ({ t: "label" as const, v })),
);

const values = fc.array(valueArb, { maxLength: 3 });
const days = fc.integer({ min: -400, max: 400 });
const op = fc.constantFrom<CompareOp>("<", "<=", ">", ">=");
const edge: fc.Arbitrary<ConditionEdge> = fc.oneof(
  fc.constant({ t: "child" as const }),
  fc.constant({ t: "mentions" as const }),
  field.map((f) => ({ t: "field" as const, field: f })),
);
const hops = fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined });

const rowArb: fc.Arbitrary<Condition> = fc.oneof(
  nodeId.map((tag) => ({ kind: "has-tag" as const, tag })),
  nodeId.map((tag) => ({ kind: "lacks-tag" as const, tag })),
  field.map((f) => ({ kind: "field-set" as const, field: f })),
  field.map((f) => ({ kind: "field-unset" as const, field: f })),
  fc.record({ field, values }).map((r) => ({ kind: "field-is" as const, ...r })),
  fc.record({ field, values }).map((r) => ({ kind: "field-is-not" as const, ...r })),
  fc
    .record({ field, text, exactCase: fc.boolean() })
    .map((r) => ({ kind: "field-contains" as const, ...r })),
  fc
    .record({
      field,
      op,
      value: fc.oneof(
        text.map((v) => ({ t: "str" as const, v })),
        number.map((v) => ({ t: "num" as const, v })),
      ),
    })
    .map((r) => ({ kind: "field-compares" as const, ...r })),
  fc
    .record({ text, exactCase: fc.boolean() })
    .map((r) => ({ kind: "text-contains" as const, ...r })),
  fc
    .record({ attr: fc.constantFrom("created" as const, "edited" as const), days })
    .map((r) => ({ kind: "instant-within" as const, ...r })),
  fc
    .record({ field, direction: fc.constantFrom("next" as const, "last" as const), days })
    .map((r) => ({ kind: "date-within" as const, ...r })),
  fc
    .record({
      kind: fc.constantFrom("under" as const, "above" as const),
      node: nodeId,
      via: edge,
      maxHops: hops,
    })
    .map(({ maxHops, ...r }) => ({ ...r, ...(maxHops === undefined ? {} : { maxHops }) })),
  nodeId.map((node) => ({ kind: "child-of" as const, node })),
  fc.constant({ kind: "has-children" as const }),
  nodeId.map((node) => ({ kind: "links-to" as const, node })),
  nodeId.map((node) => ({ kind: "linked-from" as const, node })),
);

/**
 * Branches that are each one `is` on one field (`has tag` for the type
 * field), which canonicalisation merges into one row: rare in a tree drawn
 * at large, so drawn on purpose.
 */
const isBranches: fc.Arbitrary<Condition[][]> = field.chain((f) =>
  fc.array(
    fc.oneof(
      values.map((vs): Condition[] => [{ kind: "field-is", field: f, values: vs }]),
      ...(f === "sys.f.type" ? [nodeId.map((tag): Condition[] => [{ kind: "has-tag", tag }])] : []),
    ),
    { minLength: 1, maxLength: 3 },
  ),
);

/** A list of conditions, nesting groups up to `depth` deep, empty groups and branches among them. */
export function treeArb(
  depth: number,
  row: fc.Arbitrary<Condition> = rowArb,
): fc.Arbitrary<Condition[]> {
  if (depth === 0) return fc.array(row, { maxLength: 3 });
  const inner = treeArb(depth - 1, row);
  const branches = fc.array(inner, { maxLength: 3 });
  const group: fc.Arbitrary<Condition> = fc.oneof(
    branches.map((b) => ({ kind: "any-of" as const, branches: b })),
    branches.map((b) => ({ kind: "none-of" as const, branches: b })),
    inner.map((conditions) => ({ kind: "all-of" as const, conditions })),
    isBranches.map((b) => ({ kind: "any-of" as const, branches: b })),
    isBranches.map((b) => ({ kind: "none-of" as const, branches: b })),
  );
  return fc.array(fc.oneof(row, row, group), { maxLength: 4 });
}
