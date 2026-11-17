import { Record } from "effect";
import {
  declarationPlugin,
  defineExtension,
  viewDef,
  type ExtensionMigration,
  type MigrationGraph,
} from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import {
  declaredOptionId,
  extensionNodeId,
  FIELD_TYPE_OPTION_IDS,
  FIELD_TYPE_OPTIONS,
  seededField,
  seededTag,
  SYSTEM_IDS,
  type FieldOptions,
  type FieldType,
  tagChains,
  type KbNode,
  type NodeId,
} from "@kb/model";
import { RoutinesCalendarView, RoutinesEventView, RoutinesSyncView } from "./view.ts";

/** Where a field is drawn on a node (DESIGN.md → Data model → field display); left out, always. */
type Show = FieldOptions["show"];

function field(
  label: string,
  type: FieldType,
  show?: Show,
): { label: string; type: FieldType; options: readonly []; one: boolean; show: Show };
function field<const O extends readonly string[]>(
  label: string,
  type: FieldType,
  show: Show,
  options: O,
  one?: boolean,
): { label: string; type: FieldType; options: O; one: boolean; show: Show };
function field(
  label: string,
  type: FieldType,
  show?: Show,
  options: readonly string[] = [],
  one = true,
) {
  return { label, type, options, one, show };
}
/*
 * Each field's show, by what it holds: what says what an event, an
 * occurrence, a calendar or an account is shows always; what a node of the
 * kind may or may not carry shows when filled; a calendar's adapter and id,
 * and an account's connection, are tucked, since the Sync services page is
 * where they are read; and an account's secrets, project and setup, which
 * that page writes, never. Event sync keeps no state on nodes: its statuses
 * are the host's (docs/research/2026-11-02-kb-routines-gcal.md → Status lives
 * in the host).
 */
/**
 * The family's field type for a series' rule (DESIGN.md → Field types): a
 * rule stored as text, which the page reads as the event's line words it.
 */
// GAP [[01M7KVYBVC5N8VJSBBJCYE74SE]] a family's own field type is offered in every field's type menu, and nothing says a type may not grow behaviour
export const REPEAT_KIND = "routines.repeat";
/** Its option node, which the repeat field's type slot names. */
export const REPEAT_TYPE: NodeId = declaredOptionId(FIELD_TYPE_OPTIONS, REPEAT_KIND);
const fields = {
  /** The series' rule (RRULE); empty for an event that happens once. */
  rrule: { ...field("repeat", "text", "filled"), declared: REPEAT_TYPE },
  starts: field("starts", "date"),
  at: field("at", "time"),
  duration: field("duration", "number", "filled"),
  timezone: field("timezone", "text", "filled"),
  until: field("until", "date", "filled"),
  repeatsFrom: field("repeats from", "ref", "filled", ["schedule", "completion"]),
  calendar: field("calendar", "ref", "filled"),
  status: field("gcal status", "ref", "tucked", ["pending", "synced", "error"]),
  message: field("gcal message", "text", "tucked"),
  syncedAt: field("synced at", "text", "tucked"),
  on: field("on", "date"),
  state: field("state", "ref", "filled", ["done", "skipped", "moved"]),
  movedTo: field("moved to", "date", "filled"),
  account: field("account", "ref"),
  adapter: field("adapter", "ref", "tucked", ["google"]),
  calendarId: field("calendar id", "text", "tucked"),
  sync: field("sync", "ref", undefined, ["preview", "on", "paused"]),
  email: field("email", "text"),
  clientId: field("client id", "secret", "never"),
  clientSecret: field("client secret", "secret", "never"),
  refreshToken: field("refresh token", "secret", "never"),
  project: field("google project", "text", "never"),
  /**
   * What a person confirmed by hand about their setup, which kb cannot see in
   * Google before it connects: the steps done, or `existing`, a project they
   * already had, set up and published.
   */
  setup: field(
    "setup done",
    "ref",
    "never",
    ["project", "apis", "branding", "domain", "audience", "existing"],
    false,
  ),
};
export type RoutineField = keyof typeof fields;
export type RoutineOption<K extends RoutineField> = (typeof fields)[K]["options"][number];
export function optionsFor<K extends RoutineField>(key: K): (typeof fields)[K]["options"] {
  return fields[key].options;
}
export function readRoutineOption<K extends RoutineField>(
  key: K,
  id: string | undefined,
): RoutineOption<K> | undefined {
  return fields[key].options.find((value) => routineOption(key, value) === id);
}
const fieldKeys = Record.keys(fields);
export const ROUTINE_FIELDS = Record.map(fields, (_spec, key) => "sys.f.routines." + key);
export const ROUTINE_TAGS = {
  routine: "sys.tag.routine",
  occurrence: "sys.tag.occurrence",
  calendar: "sys.tag.calendar",
  account: "sys.tag.google-account",
} as const;
export function routineOption(fieldKey: RoutineField, value: string): string {
  return ROUTINE_FIELDS[fieldKey] + "." + value.replaceAll(" ", "-");
}
const tags: readonly [string, string, readonly RoutineField[]][] = [
  [
    ROUTINE_TAGS.routine,
    "event",
    ["rrule", "starts", "at", "duration", "timezone", "until", "repeatsFrom", "calendar"],
  ],
  [ROUTINE_TAGS.occurrence, "occurrence", ["on", "state", "movedTo", "at"]],
  [ROUTINE_TAGS.calendar, "calendar", ["account", "adapter", "calendarId", "timezone", "sync"]],
  [
    ROUTINE_TAGS.account,
    "google-account",
    [
      "email",
      "clientId",
      "clientSecret",
      "refreshToken",
      "project",
      "setup",
      "status",
      "message",
      "syncedAt",
    ],
  ],
];
export function routinesSeed(at: string): readonly KbNode[] {
  const nodes: KbNode[] = [];
  for (const key of fieldKeys) {
    const spec = fields[key];
    const id = ROUTINE_FIELDS[key];
    const target =
      key === "calendar" ? ROUTINE_TAGS.calendar : key === "account" ? ROUTINE_TAGS.account : null;
    nodes.push({
      ...seededField(id, spec.label, spec.type, at, {
        one: spec.one,
        show: spec.show,
        props: {
          ...(target === null ? {} : { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: target }] }),
          // A field of a type the family declares names that type, which stores as `spec.type`.
          ...("declared" in spec
            ? { [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: spec.declared }] }
            : {}),
        },
      }),
      children: spec.options.map((value) => routineOption(key, value)),
    });
    for (const value of spec.options) {
      nodes.push({
        id: routineOption(key, value),
        text: value,
        children: [],
        props: {},
        createdAt: at,
        updatedAt: at,
      });
    }
  }
  for (const [id, label, keys] of tags)
    nodes.push(
      seededTag(
        id,
        label,
        keys.map((key) => ROUTINE_FIELDS[key]),
        at,
      ),
    );
  return nodes;
}
/** The repeat field as a store seeded before its type holds it: typed text. */
function untypedRepeat(graph: MigrationGraph): KbNode | null {
  const node = graph.nodeOf(ROUTINE_FIELDS.rrule);
  const [type, ...more] = node?.props[SYSTEM_IDS.fieldTypeField] ?? [];
  const text = more.length === 0 && type?.t === "ref" && type.v === FIELD_TYPE_OPTION_IDS.text;
  return node !== undefined && text ? node : null;
}

/**
 * The family's migration `routines.repeat-type` (DESIGN.md → Plugin data
 * migrations): the repeat field of a store seeded before the family
 * declared its type takes that type. Its values stay the rules they are.
 * Pure and idempotent: a field already of the type plans nothing.
 */
const repeatTypeMigration: ExtensionMigration = {
  id: "repeat-type",
  title: "Read an event's repeat in words",
  description:
    "An event's repeat field was typed text, so it showed its rule (FREQ=WEEKLY). It takes the repeat type, which reads as the event's line does (Weekly on Tue) and still edits as the rule. Its values do not change.",
  run: (graph) => {
    const repeat = untypedRepeat(graph);
    return {
      upserts:
        repeat === null
          ? []
          : [
              {
                ...repeat,
                props: {
                  ...repeat.props,
                  [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: REPEAT_TYPE }],
                },
                updatedAt: graph.at,
              },
            ],
      deletes: [],
    };
  },
  check: (graph) =>
    untypedRepeat(graph) === null ? [] : [`${ROUTINE_FIELDS.rrule} is still typed text`],
};

/**
 * The fields event sync kept on nodes before its state moved to the host,
 * by id: Google's link, the status, its message, Google's event id and when
 * it synced. The link and the event id are no longer seeded at all.
 */
const SYNC_FIELDS = ["gcal", "status", "message", "eventId", "syncedAt"].map(
  (key) => "sys.f.routines." + key,
);
const UNSEEDED_FIELDS = ["sys.f.routines.gcal", "sys.f.routines.eventId"];
/** The tags whose nodes held sync state, and which templated it. */
const SYNCED_TAGS: readonly NodeId[] = [
  ROUTINE_TAGS.routine,
  ROUTINE_TAGS.occurrence,
  ROUTINE_TAGS.calendar,
];

/** `node` without the prop keys in `drop`, and its template without the fields in `untemplate`. */
function without(node: KbNode, drop: readonly string[], untemplate: readonly string[]): KbNode {
  const props = { ...node.props };
  for (const key of drop) delete props[key];
  const template = props[SYSTEM_IDS.fieldsField];
  if (template !== undefined)
    props[SYSTEM_IDS.fieldsField] = template.filter(
      (value) => !(value.t === "ref" && untemplate.includes(value.v)),
    );
  return { ...node, props };
}
/** Whether any node of `nodes` still names `id`: as a field it holds, a value, or a child. */
function named(nodes: readonly KbNode[], id: NodeId): boolean {
  return nodes.some(
    (node) =>
      node.id !== id &&
      (id in node.props ||
        node.children.includes(id) ||
        Object.values(node.props).some((values) =>
          values.some((value) => value.t === "ref" && value.v === id),
        )),
  );
}
/** What still holds sync state in `graph`, one line each. */
function syncLeft(graph: MigrationGraph): readonly string[] {
  const { isA } = tagChains(graph.nodeOf);
  const left: string[] = [];
  for (const node of graph.nodes) {
    if (SYNCED_TAGS.some((tag) => isA(node, tag)))
      for (const key of SYNC_FIELDS) if (key in node.props) left.push(`${node.id} holds ${key}`);
    const untemplate = SYNCED_TAGS.includes(node.id)
      ? SYNC_FIELDS
      : node.id === ROUTINE_TAGS.account
        ? UNSEEDED_FIELDS
        : [];
    for (const value of node.props[SYSTEM_IDS.fieldsField] ?? [])
      if (value.t === "ref" && untemplate.includes(value.v))
        left.push(`${node.id} templates ${value.v}`);
  }
  return left;
}

/**
 * The family's migration `routines.sync-off-nodes` (docs/research/2026-11-02-kb-routines-gcal.md
 * → Migration): event sync's state comes off the store. Each event,
 * occurrence and calendar loses the five fields' values, its tag stops
 * templating them, and the account's tag stops templating the event id. The
 * link and event id fields go too, unless another node still names them,
 * which makes them the person's. Nothing else changes. Pure and idempotent:
 * a store without sync state plans nothing.
 */
const syncOffNodesMigration: ExtensionMigration = {
  id: "sync-off-nodes",
  title: "Take sync state off events",
  description:
    "Event sync kept its status, message, Google's link and id, and when it synced on each event, occurrence and calendar. Sync now works those out from Google each time and keeps them in the running host, so these fields only go stale. They are removed from those nodes and their tags; nothing else changes.",
  run: (graph) => {
    const { isA } = tagChains(graph.nodeOf);
    const upserts: KbNode[] = [];
    for (const node of graph.nodes) {
      const synced = SYNCED_TAGS.some((tag) => isA(node, tag));
      const untemplate = SYNCED_TAGS.includes(node.id)
        ? SYNC_FIELDS
        : node.id === ROUTINE_TAGS.account
          ? UNSEEDED_FIELDS
          : [];
      const next = without(node, synced ? SYNC_FIELDS : [], untemplate);
      if (JSON.stringify(next.props) !== JSON.stringify(node.props))
        upserts.push({ ...next, updatedAt: graph.at });
    }
    const written = new Map(upserts.map((node) => [node.id, node]));
    const after = graph.nodes.map((node) => written.get(node.id) ?? node);
    const deletes = UNSEEDED_FIELDS.filter(
      (id) => graph.nodeOf(id) !== undefined && !named(after, id),
    );
    return { upserts, deletes };
  },
  check: syncLeft,
};

export const routinesExtension = defineExtension({
  name: "routines",
  label: "Events",
  manifest: {
    description: "Events and their occurrences on a calendar, synced with Google Calendar.",
  },
  tags: ["event", "occurrence", "calendar", "google-account"],
  optional: { byDefault: "off" },
  seed: routinesSeed,
  // Its repeat field's type: a rule, stored as text.
  declaredOptions: [
    {
      kind: FIELD_TYPE_OPTIONS,
      options: [
        { id: REPEAT_KIND, label: "repeat", chooses: [{ kind: FIELD_TYPE_OPTIONS, id: "text" }] },
      ],
    },
  ],
  migrations: [repeatTypeMigration, syncOffNodesMigration],
  retires: [
    // Routines became events, a routine an event and its rule the event's
    // repeat: labels only, so every id stays.
    { from: extensionNodeId("routines"), to: extensionNodeId("routines"), text: "Routines" },
    { from: ROUTINE_TAGS.routine, to: ROUTINE_TAGS.routine, text: "routine" },
    { from: ROUTINE_FIELDS.rrule, to: ROUTINE_FIELDS.rrule, text: "rrule" },
  ],
  views: [viewDef(RoutinesCalendarView), viewDef(RoutinesSyncView), viewDef(RoutinesEventView)],
  // An event opens in its own box, the calendar's, and previews it live.
  tagDefaultViews: { [ROUTINE_TAGS.routine]: RoutinesEventView },
  host: {
    capabilities: [
      {
        name: "sync",
        reason:
          "event sync, and connecting its Google accounts, keep their state in the kb ui process",
        actions: [
          "preview",
          "status",
          "setup",
          "binding",
          "automate",
          "client",
          "connect",
          "finish",
          "provision",
          "remove",
          "sync",
          "release",
        ],
      },
    ],
  },
});

/** The status channel's id, as the host entry contributes it; the server names it under the family. */
export const STATUS_CHANNEL_ID = "status";
/** The family's plugin channel that carries `SyncStatuses` to a page, by its full name. */
export const STATUS_CHANNEL = `${routinesExtension.name}.${STATUS_CHANNEL_ID}`;

/** The family's shared plugin: its declaration's view, which both hosts' entries load. */
export function routinesDeclarationPlugin(): Plugin {
  return declarationPlugin(routinesExtension);
}
