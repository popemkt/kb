import { Record } from "effect";
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import {
  extensionNodeId,
  seededField,
  seededTag,
  SYSTEM_IDS,
  type FieldOptions,
  type FieldType,
  type KbNode,
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
 * kind may or may not carry shows when filled; the sync state kb writes
 * (Google's id, link, status, message and time, a calendar's adapter and
 * id) is tucked, since the Sync services page is where it is read; and an
 * account's secrets, project and setup, which that page writes, never.
 */
const fields = {
  /** The series' rule (RRULE); empty for an event that happens once. */
  rrule: field("repeat", "text", "filled"),
  starts: field("starts", "date"),
  at: field("at", "time"),
  duration: field("duration", "number", "filled"),
  timezone: field("timezone", "text", "filled"),
  until: field("until", "date", "filled"),
  repeatsFrom: field("repeats from", "ref", "filled", ["schedule", "completion"]),
  calendar: field("calendar", "ref", "filled"),
  gcal: field("gcal link", "url", "tucked"),
  status: field("gcal status", "ref", "tucked", ["pending", "synced", "error"]),
  message: field("gcal message", "text", "tucked"),
  eventId: field("gcal event id", "text", "tucked"),
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
    [
      "rrule",
      "starts",
      "at",
      "duration",
      "timezone",
      "until",
      "repeatsFrom",
      "calendar",
      "gcal",
      "status",
      "message",
      "eventId",
      "syncedAt",
    ],
  ],
  [
    ROUTINE_TAGS.occurrence,
    "occurrence",
    ["on", "state", "movedTo", "at", "gcal", "status", "message", "eventId", "syncedAt"],
  ],
  [
    ROUTINE_TAGS.calendar,
    "calendar",
    [
      "account",
      "adapter",
      "calendarId",
      "timezone",
      "sync",
      "status",
      "message",
      "eventId",
      "syncedAt",
    ],
  ],
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
      "eventId",
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
        props: target === null ? {} : { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: target }] },
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
export const routinesExtension = defineExtension({
  name: "routines",
  label: "Events",
  manifest: {
    description: "Events and their occurrences on a calendar, synced with Google Calendar.",
  },
  tags: ["event", "occurrence", "calendar", "google-account"],
  optional: { byDefault: "off" },
  seed: routinesSeed,
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

/** The family's shared plugin: its declaration's view, which both hosts' entries load. */
export function routinesDeclarationPlugin(): Plugin {
  return declarationPlugin(routinesExtension);
}
