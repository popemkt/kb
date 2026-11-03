import { Schema } from "effect";
import {
  decodeNodeConfig,
  firstNum,
  firstRef,
  firstStr,
  oneOf,
  typeRefsOf,
  writeNum,
  writeRef,
  writeStr,
  type ConfigSlot,
  type NodeLike,
  type PropValue,
} from "@kb/model";
import { SyncError, type Occurrence, type Routine, type SyncStatus } from "./model.ts";
import {
  optionsFor,
  readRoutineOption,
  routineOption,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  type RoutineField,
  type RoutineOption,
} from "./seed.ts";

function text(key: RoutineField, fallback = "") {
  return oneOf({
    fields: [F[key]],
    read: firstStr(F[key]),
    write: writeStr(F[key]),
    schema: Schema.String,
    fallback,
  });
}
function ref(key: RoutineField) {
  return oneOf({
    fields: [F[key]],
    read: firstRef(F[key]),
    write: writeRef(F[key]),
    schema: Schema.String,
    fallback: "",
  });
}
function option<K extends RoutineField>(
  key: K,
  fallback: RoutineOption<K> | null,
): ConfigSlot<RoutineOption<K> | null> {
  return oneOf({
    fields: [F[key]],
    read: (props) => readRoutineOption(key, firstRef(F[key])(props)),
    write: (value) =>
      value === null ? { [F[key]]: [] } : writeRef(F[key])(routineOption(key, value)),
    schema: Schema.NullOr(Schema.Literals(optionsFor(key))),
    fallback,
  });
}
const ROUTINE = {
  starts: text("starts"),
  at: text("at"),
  duration: oneOf({
    fields: [F.duration],
    read: firstNum(F.duration),
    write: writeNum(F.duration),
    schema: Schema.Finite,
    fallback: 30,
  }),
  zone: text("timezone"),
  rrule: text("rrule"),
  until: text("until"),
  repeatsFrom: option("repeatsFrom", "schedule"),
  calendar: ref("calendar"),
};
const OCCURRENCE = {
  on: text("on"),
  state: option("state", null),
  movedTo: text("movedTo"),
  at: text("at"),
};
export const DEFAULT_ROUTINE_ZONE = "Asia/Ho_Chi_Minh";
const CALENDAR = {
  account: ref("account"),
  calendarId: text("calendarId"),
  zone: text("timezone", DEFAULT_ROUTINE_ZONE),
  mode: option("sync", "preview"),
  adapter: option("adapter", "google"),
};
const ACCOUNT = {
  email: text("email"),
  clientId: text("clientId"),
  clientSecret: text("clientSecret"),
  refreshToken: text("refreshToken"),
};
const invalid = () => new SyncError({ status: 400, code: "invalid_rule" });

export function readRoutine(node: NodeLike, zone: string): { routine: Routine; calendar: string } {
  const read = decodeNodeConfig(ROUTINE, node.props, () => {
    throw invalid();
  });
  const repeatsFrom = read("repeatsFrom");
  if (repeatsFrom === null) throw invalid();
  return {
    calendar: read("calendar"),
    routine: {
      id: node.id,
      title: node.text,
      starts: read("starts"),
      at: read("at") || null,
      duration: read("duration"),
      zone: read("zone") || zone,
      rrule: read("rrule"),
      until: read("until") || null,
      repeatsFrom,
    },
  };
}
export function readOccurrence(node: NodeLike): Occurrence {
  const read = decodeNodeConfig(OCCURRENCE, node.props, () => {
    throw invalid();
  });
  const state = read("state");
  if (state === null) throw invalid();
  return {
    id: node.id,
    on: read("on"),
    state,
    movedTo: read("movedTo") || null,
    at: read("at") || null,
  };
}
/** The occurrence facts under a routine, by their original day: one fact per day. */
export function routineOccurrences(
  node: NodeLike,
  nodes: ReadonlyMap<string, NodeLike>,
): ReadonlyMap<string, { readonly node: NodeLike; readonly occurrence: Occurrence }> {
  const found = new Map<string, { node: NodeLike; occurrence: Occurrence }>();
  for (const id of node.children) {
    const child = nodes.get(id);
    if (child === undefined || !typeRefsOf(child).includes(T.occurrence)) continue;
    const occurrence = readOccurrence(child);
    if (found.has(occurrence.on))
      throw new SyncError({ status: 400, code: "duplicate_occurrence" });
    found.set(occurrence.on, { node: child, occurrence });
  }
  return found;
}
export function readCalendar(node: NodeLike) {
  const read = decodeNodeConfig(CALENDAR, node.props, () => {
    throw invalid();
  });
  const mode = read("mode");
  const adapter = read("adapter");
  if (mode === null || adapter === null) throw invalid();
  return {
    account: read("account"),
    calendarId: read("calendarId"),
    zone: read("zone") || DEFAULT_ROUTINE_ZONE,
    mode,
    adapter,
    id: node.id,
    name: node.text,
  };
}
export function readAccount(node: NodeLike) {
  const read = decodeNodeConfig(ACCOUNT, node.props, () => {
    throw new SyncError({ status: 401, code: "auth_needed" });
  });
  return {
    email: read("email"),
    clientId: read("clientId"),
    clientSecret: read("clientSecret"),
    refreshToken: read("refreshToken"),
    id: node.id,
  };
}
export type CalendarConfig = ReturnType<typeof readCalendar>;
/** The zone a routine's times fall back to: its calendar's, else the default. */
export function routineZone(node: NodeLike, nodes: ReadonlyMap<string, NodeLike>): string {
  const calendar = nodes.get(firstRef(F.calendar)(node.props) ?? "");
  return calendar === undefined ? DEFAULT_ROUTINE_ZONE : readCalendar(calendar).zone;
}
/** A sync status as the node fields it is stored in; null clears a field. */
export function syncStatusProps(status: SyncStatus): Readonly<Record<string, PropValue | null>> {
  return {
    [F.status]: { t: "ref", v: routineOption("status", status.state) },
    [F.message]: status.message === "" ? null : { t: "str", v: status.message },
    ...(status.eventId === undefined ? {} : { [F.eventId]: { t: "str", v: status.eventId } }),
    ...(status.url === undefined ? {} : { [F.gcal]: { t: "str", v: status.url } }),
    ...(status.at === undefined ? {} : { [F.syncedAt]: { t: "str", v: status.at } }),
  };
}
export type AccountConfig = ReturnType<typeof readAccount>;
export interface CalendarBinding {
  readonly calendar: CalendarConfig;
  readonly account: AccountConfig | null;
}

const selected = (
  entry: NodeLike,
  slots: Readonly<Record<string, { readonly fields: readonly string[] }>>,
) => {
  const fields = [...new Set(Object.values(slots).flatMap((slot) => slot.fields))];
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(entry.props, field))
      .map((field) => [field, entry.props[field]]),
  );
};

/** Dependency fingerprints derive from the same slots that decode the fields. */
export function routineInputs(node: NodeLike, nodes: ReadonlyMap<string, NodeLike>, zone: string) {
  const children = node.children
    .map((id) => nodes.get(id))
    .filter(
      (child): child is NodeLike => child !== undefined && typeRefsOf(child).includes(T.occurrence),
    );
  return {
    value: {
      text: node.text,
      props: selected(node, ROUTINE),
      zone,
      children: children.map((child) => ({ id: child.id, props: selected(child, OCCURRENCE) })),
    },
    ids: [node.id, ...children.map((child) => child.id)],
  };
}
