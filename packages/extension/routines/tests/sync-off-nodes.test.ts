/**
 * Taking sync state off the store (docs/research/2026-11-02-kb-routines-gcal.md
 * → Migration, `routines.sync-off-nodes`): events, occurrences and calendars
 * lose the five sync fields' values and their tags stop templating them, the
 * link and event id fields go unless a person's node still names them, and
 * everything a person added stays. Pure and idempotent.
 */
import { expect, test } from "bun:test";
import type { MigrationGraph } from "@kb/contracts";
import { SYSTEM_IDS, type KbNode, type PropValue } from "@kb/model";
import {
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  routineOption,
  routinesExtension,
  routinesSeed,
} from "../src/index.ts";

const AT = "2026-11-01T00:00:00.000Z";
const LATER = "2026-11-17T00:00:00.000Z";
const GCAL = "sys.f.routines.gcal";
const EVENT_ID = "sys.f.routines.eventId";
const NOTE = "person.f.note";

const migration = routinesExtension.migrations?.find(({ id }) => id === "sync-off-nodes");
if (migration === undefined) throw new Error("routines declares no sync-off-nodes migration");

function graph(nodes: readonly KbNode[]): MigrationGraph {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return { nodes, nodeOf: (id) => byId.get(id), at: LATER };
}
const ref = (v: string): PropValue => ({ t: "ref", v });
const str = (v: string): PropValue => ({ t: "str", v });
const node = (id: string, props: KbNode["props"], children: string[] = []): KbNode => ({
  id,
  text: id,
  children,
  props,
  createdAt: AT,
  updatedAt: AT,
});
const field = (id: string, text: string): KbNode => ({
  ...node(id, { [SYSTEM_IDS.typeField]: [ref("sys.field")] }),
  text,
});
const templates = (tag: KbNode | undefined) =>
  (tag?.props[SYSTEM_IDS.fieldsField] ?? []).map((value) => value.v);

/** What sync wrote on a node, as the engine before this change wrote it. */
const SYNCED = {
  [GCAL]: [str("https://calendar.google.com/event?eid=x")],
  [F.status]: [ref(routineOption("status", "synced"))],
  [F.message]: [str("")],
  [EVENT_ID]: [str("google-id")],
  [F.syncedAt]: [str("2026-11-02T00:00:00Z")],
};
const SYNC_KEYS = Object.keys(SYNCED);

/**
 * A store from before: the seed with the link and event id fields, its tags
 * templating the sync fields, and a person's note field added to the event
 * tag; an event, its occurrence and its calendar holding sync state beside the
 * person's own values, and an account holding its connection.
 */
function older(): KbNode[] {
  const seeded = routinesSeed(AT).map((seed) => {
    const extra =
      seed.id === T.routine || seed.id === T.occurrence || seed.id === T.calendar
        ? SYNC_KEYS
        : seed.id === T.account
          ? [EVENT_ID]
          : [];
    const added = seed.id === T.routine ? [NOTE] : [];
    if (extra.length === 0 && added.length === 0) return seed;
    const fields = [...(seed.props[SYSTEM_IDS.fieldsField] ?? [])];
    for (const id of [...extra, ...added])
      if (!fields.some((value) => value.v === id)) fields.push(ref(id));
    return { ...seed, props: { ...seed.props, [SYSTEM_IDS.fieldsField]: fields } };
  });
  return [
    ...seeded,
    field(GCAL, "gcal link"),
    field(EVENT_ID, "gcal event id"),
    field(NOTE, "note"),
    node("cal", { [SYSTEM_IDS.typeField]: [ref(T.calendar)], ...SYNCED }),
    node(
      "gym",
      {
        [SYSTEM_IDS.typeField]: [ref(T.routine)],
        [F.calendar]: [ref("cal")],
        [F.rrule]: [str("FREQ=DAILY")],
        [NOTE]: [str("bring a towel")],
        ...SYNCED,
      },
      ["done"],
    ),
    node("done", {
      [SYSTEM_IDS.typeField]: [ref(T.occurrence)],
      [F.on]: [str("2026-11-03")],
      [F.state]: [ref(routineOption("state", "done"))],
      ...SYNCED,
    }),
    node("acct", {
      [SYSTEM_IDS.typeField]: [ref(T.account)],
      [F.status]: [ref(routineOption("status", "synced"))],
      [F.syncedAt]: [str("2026-11-02T00:00:00Z")],
    }),
  ];
}

/** `nodes` with `plan` applied, as the migration's one transaction applies it. */
function applied(nodes: readonly KbNode[], plan: ReturnType<NonNullable<typeof migration>["run"]>) {
  const written = new Map(plan.upserts.map((upsert) => [upsert.id, upsert]));
  return nodes
    .filter((held) => !plan.deletes.includes(held.id))
    .map((held) => written.get(held.id) ?? held);
}

test("sync state comes off events, occurrences and calendars, and their tags stop templating it", () => {
  const before = older();
  expect(migration.check?.(graph(before)).length).toBeGreaterThan(0);
  const plan = migration.run(graph(before));
  const after = new Map(applied(before, plan).map((held) => [held.id, held]));
  for (const id of ["cal", "gym", "done"])
    for (const key of SYNC_KEYS) expect(after.get(id)?.props[key]).toBeUndefined();
  for (const tag of [T.routine, T.occurrence, T.calendar])
    for (const key of SYNC_KEYS) expect(templates(after.get(tag))).not.toContain(key);
  expect(templates(after.get(T.account))).not.toContain(EVENT_ID);
  expect(plan.deletes.toSorted()).toEqual([EVENT_ID, GCAL]);
  expect(migration.check?.(graph([...after.values()]))).toEqual([]);
});

test("what a person added stays: their field, its value, the event's facts and the account's connection", () => {
  const before = older();
  const after = new Map(
    applied(before, migration.run(graph(before))).map((held) => [held.id, held]),
  );
  const was = new Map(before.map((held) => [held.id, held]));
  expect(after.get("gym")?.props[NOTE]).toEqual([str("bring a towel")]);
  expect(templates(after.get(T.routine))).toContain(NOTE);
  expect(after.get("gym")?.children).toEqual(["done"]);
  expect(after.get("done")?.props[F.state]).toEqual(was.get("done")?.props[F.state]);
  expect(after.get("acct")).toEqual(was.get("acct"));
  expect(after.get(NOTE)).toEqual(was.get(NOTE));
});

test("a link or event id field a person's node still names is theirs, and stays", () => {
  const before = [...older(), node("mine", { [GCAL]: [str("https://example.com/mine")] })];
  const plan = migration.run(graph(before));
  expect(plan.deletes).toEqual([EVENT_ID]);
  const mine = applied(before, plan).find((held) => held.id === "mine");
  expect(mine?.props[GCAL]).toEqual([str("https://example.com/mine")]);
});

test("a store without sync state plans nothing, so the migration is not pending there", () => {
  const seeded = graph(routinesSeed(AT));
  expect(migration.run(seeded)).toEqual({ upserts: [], deletes: [] });
  expect(migration.check?.(seeded)).toEqual([]);
  const before = older();
  const once = applied(before, migration.run(graph(before)));
  expect(migration.run(graph(once))).toEqual({ upserts: [], deletes: [] });
});
