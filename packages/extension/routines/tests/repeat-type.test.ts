/**
 * The repeat field's type (DESIGN.md → Plugin data migrations,
 * `routines.repeat-type`): the seed names the family's repeat type on the
 * field, the type stores as text, and the migration gives the type to a
 * field seeded before it, once.
 */
import { expect, test } from "bun:test";
import type { MigrationGraph } from "@kb/contracts";
import { FIELD_TYPE_OPTION_IDS, FIELD_TYPE_OPTIONS, SYSTEM_IDS, type KbNode } from "@kb/model";
import { REPEAT_KIND, ROUTINE_FIELDS, routinesExtension, routinesSeed } from "../src/index.ts";
import { REPEAT_TYPE } from "../src/seed.ts";

const AT = "2026-11-17T00:00:00.000Z";
const LATER = "2026-11-18T00:00:00.000Z";
const typeOf = (node: KbNode | undefined) => node?.props[SYSTEM_IDS.fieldTypeField];

function graph(nodes: readonly KbNode[]): MigrationGraph {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return { nodes, nodeOf: (id) => byId.get(id), at: LATER };
}

const migration = routinesExtension.migrations?.find(({ id }) => id === "repeat-type");
if (migration === undefined) throw new Error("routines declares no repeat-type migration");

/** The seed as a store seeded before the type has it: its repeat field typed text. */
const older = routinesSeed(AT).map((node) =>
  node.id === ROUTINE_FIELDS.rrule
    ? {
        ...node,
        props: {
          ...node.props,
          [SYSTEM_IDS.fieldTypeField]: [{ t: "ref" as const, v: FIELD_TYPE_OPTION_IDS.text }],
        },
      }
    : node,
);

test("the seed types its repeat field with the family's repeat type, which stores as text", () => {
  const field = routinesSeed(AT).find((node) => node.id === ROUTINE_FIELDS.rrule);
  expect(typeOf(field)).toEqual([{ t: "ref", v: REPEAT_TYPE }]);
  const declared = routinesExtension.declaredOptions?.find(
    ({ kind }) => kind === FIELD_TYPE_OPTIONS,
  );
  expect(declared?.options).toEqual([
    { id: REPEAT_KIND, label: "repeat", chooses: [{ kind: FIELD_TYPE_OPTIONS, id: "text" }] },
  ]);
});

test("the migration gives the type to a repeat field seeded before it, and keeps its values", () => {
  const before = graph(older);
  expect(migration.check?.(before)).toEqual([`${ROUTINE_FIELDS.rrule} is still typed text`]);
  const plan = migration.run(before);
  expect(plan.deletes).toEqual([]);
  expect(plan.upserts).toHaveLength(1);
  const [field] = plan.upserts;
  const was = older.find((node) => node.id === ROUTINE_FIELDS.rrule);
  expect(field).toEqual({
    ...was,
    props: { ...was?.props, [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: REPEAT_TYPE }] },
    updatedAt: LATER,
  } as KbNode);
});

test("a store already of the type plans nothing, so the migration is not pending there", () => {
  const seeded = graph(routinesSeed(AT));
  expect(migration.run(seeded)).toEqual({ upserts: [], deletes: [] });
  expect(migration.check?.(seeded)).toEqual([]);
  const migrated = graph(
    older.map(
      (node) => migration.run(graph(older)).upserts.find(({ id }) => id === node.id) ?? node,
    ),
  );
  expect(migration.run(migrated).upserts).toEqual([]);
});
