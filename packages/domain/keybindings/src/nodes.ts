/** Keyboard data as ordinary nodes; executable targets remain registered code. */
import { Option, Schema, Record as Records } from "effect";
import { namespaced } from "@kb/plugin";
import {
  canonicalJson,
  declaredOptionId,
  type DeclaredOptionSet,
  type DeclaredOptions,
  childrenTargetQuery,
  seededField,
  seededTag,
  SYSTEM_IDS,
  refValuesOf,
  type KbNode,
  type NodeLike,
} from "@kb/model";
import { ChordDataSchema, type ChordData } from "./chord-data.ts";
import { describeChord, type Chord } from "./chord.ts";
import { keyboardIn, type ActionCall, type KeyRun, type KeyboardDefinition } from "./bindings.ts";

export const SHORTCUT_IDS = {
  tag: "sys.shortcut",
  chord: "sys.shortcut.chord",
  call: "sys.call",
  action: "sys.f.call.action",
  input: "sys.f.call.input",
  keys: "sys.f.shortcut.keys",
  runs: "sys.f.shortcut.runs",
  where: "sys.f.shortcut.where",
  enabled: "sys.f.shortcut.enabled",
  replaces: "sys.f.shortcut.replaces",
  matcher: "sys.f.shortcut.matcher",
  characters: "sys.f.shortcut.characters",
  except: "sys.f.shortcut.except",
  keySet: "sys.shortcut.matcher.keys",
  printable: "sys.shortcut.matcher.printable",
  modifierStates: "sys.shortcut.modifiers",
  required: "sys.shortcut.modifier.required",
  excluded: "sys.shortcut.modifier.excluded",
} as const;

const KEY_CONTEXT_OPTIONS: DeclaredOptions = {
  field: SHORTCUT_IDS.where,
  prefix: "sys.shortcut.context.",
};
const KEY_INTENT_OPTIONS: DeclaredOptions = {
  field: SHORTCUT_IDS.runs,
  prefix: "sys.shortcut.intent.",
};

/** Each scalar's graph address and carrier, exhaustive over the codec's members. */
const SCALARS = {
  code: { field: "sys.f.shortcut.code", label: "Physical key", kind: "text" },
  mod: { field: "sys.f.shortcut.mod", label: "Command or Control", kind: "modifier" },
  meta: { field: "sys.f.shortcut.meta", label: "Command", kind: "modifier" },
  ctrl: { field: "sys.f.shortcut.ctrl", label: "Control", kind: "modifier" },
  shift: { field: "sys.f.shortcut.shift", label: "Shift", kind: "modifier" },
  alt: { field: "sys.f.shortcut.alt", label: "Alt", kind: "modifier" },
} as const satisfies Record<
  Exclude<keyof ChordData, "key">,
  { readonly field: string; readonly label: string; readonly kind: "text" | "modifier" }
>;

export function shortcutNodeId(binding: string): string {
  return `sys.shortcut.binding.${binding}`;
}
function keyContextNodeId(context: string): string {
  return declaredOptionId(KEY_CONTEXT_OPTIONS, context);
}
/** A tuple encoding: punctuation inside either member cannot become its separator. */
function intentKey(context: string, intent: string): string {
  return `${encodeURIComponent(context)}:${encodeURIComponent(intent)}`;
}

const CallInput = Schema.Json.pipe(Schema.decodeTo(Schema.JsonObject));

/** Stored calls preserve the action's object input contract and contain JSON data only. */
export function normalizedCall(call: ActionCall): { action: string; input: Schema.JsonObject } {
  const input = Schema.decodeUnknownSync(CallInput)(call.input === undefined ? {} : call.input);
  return { action: call.action, input: structuredClone(input) };
}

/** Commands name their registered node; intents name their context/intent tuple. */
export function keyTargetNodeId(family: string, context: string, run: KeyRun): string {
  if ("intent" in run) return declaredOptionId(KEY_INTENT_OPTIONS, intentKey(context, run.intent));
  if ("command" in run) return run.command;
  // Recipes belong to their declaring family, like its other seeded data. Within that
  // declaration equal calls share one recipe, independently of the binding ids.
  return `sys.call.generated.${encodeURIComponent(family)}:${encodeURIComponent(canonicalJson(normalizedCall(run)))}`;
}

function node(
  id: string,
  text: string,
  tag: string | null,
  at: string,
  props: KbNode["props"] = {},
): KbNode {
  return {
    id,
    text,
    props: {
      ...(tag === null ? {} : { [SYSTEM_IDS.typeField]: [{ t: "ref", v: tag }] }),
      ...props,
    },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/** The ordinary field/tag schema; core seeds it once, families seed only their descriptions. */
export function keyboardSchemaNodes(at: string): KbNode[] {
  const ref = (id: string, label: string, target: string, one: boolean) =>
    seededField(id, label, "ref", at, {
      one,
      props: { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: target }] },
    });
  const matcher = seededField(SHORTCUT_IDS.matcher, "key matcher", "ref", at, { one: true });
  matcher.children = [SHORTCUT_IDS.keySet, SHORTCUT_IDS.printable];
  const states = node(SHORTCUT_IDS.modifierStates, "modifier constraints", null, at);
  states.children = [SHORTCUT_IDS.required, SHORTCUT_IDS.excluded];
  return [
    states,
    node(SHORTCUT_IDS.required, "required", null, at),
    node(SHORTCUT_IDS.excluded, "excluded", null, at),
    seededTag(SHORTCUT_IDS.call, "call", [SHORTCUT_IDS.action, SHORTCUT_IDS.input], at),
    seededField(SHORTCUT_IDS.action, "action", "text", at, { one: true }),
    seededField(SHORTCUT_IDS.input, "input", "text", at, { one: true }),
    seededTag(
      SHORTCUT_IDS.tag,
      "shortcut",
      [
        SHORTCUT_IDS.keys,
        SHORTCUT_IDS.runs,
        SHORTCUT_IDS.where,
        SHORTCUT_IDS.enabled,
        SHORTCUT_IDS.replaces,
      ],
      at,
    ),
    seededTag(
      SHORTCUT_IDS.chord,
      "key chord",
      [
        SHORTCUT_IDS.matcher,
        SHORTCUT_IDS.characters,
        SHORTCUT_IDS.except,
        ...Object.values(SCALARS).map(({ field }) => field),
      ],
      at,
    ),

    ref(SHORTCUT_IDS.keys, "keys", SHORTCUT_IDS.chord, true),
    seededField(SHORTCUT_IDS.runs, "runs", "ref", at, {
      one: true,
      props: {
        [SYSTEM_IDS.targetQueryField]: [
          {
            t: "str",
            v: `[:find ?id :where [?n :node/id ?id] (or-join [?n] (and [?p :node/id "${SHORTCUT_IDS.runs}"] [?p :node/child ?n]) (and [?t :node/id "${SYSTEM_IDS.command}"] [?n :f/sys.f.type ?t]) (and [?t :node/id "${SHORTCUT_IDS.call}"] [?n :f/sys.f.type ?t]))]`,
          },
        ],
      },
    }),
    seededField(SHORTCUT_IDS.where, "where", "ref", at, { one: true }),
    ref(SHORTCUT_IDS.replaces, "replaces", SHORTCUT_IDS.tag, true),
    seededField(SHORTCUT_IDS.enabled, "enabled", "checkbox", at, { one: true }),
    matcher,
    node(SHORTCUT_IDS.keySet, "these characters", null, at),
    node(SHORTCUT_IDS.printable, "printable character", null, at),
    seededField(SHORTCUT_IDS.characters, "characters", "text", at),
    seededField(SHORTCUT_IDS.except, "except characters", "text", at),
    ...Object.values(SCALARS).map(({ label, field, kind }) =>
      seededField(field, label, kind === "text" ? "text" : "ref", at, {
        one: true,
        ...(kind === "text"
          ? {}
          : {
              props: {
                [SYSTEM_IDS.targetQueryField]: [
                  { t: "str", v: childrenTargetQuery(SHORTCUT_IDS.modifierStates) },
                ],
              },
            }),
      }),
    ),
  ];
}

/** Canonical data drops representation-only differences between one character and a one-item set. */
export function chordData(chord: Chord): ChordData {
  const data = Schema.decodeUnknownSync(ChordDataSchema)(chord);
  const key = data.key;
  return {
    ...data,
    ...(key === undefined
      ? {}
      : {
          key:
            typeof key === "string"
              ? [key]
              : "kind" in key
                ? { kind: key.kind, except: [...new Set(key.except)].toSorted() }
                : [...new Set(key)].toSorted(),
        }),
  };
}

export function chordNode(id: string, chord: Chord, at: string): KbNode {
  const data = chordData(chord);
  const props: KbNode["props"] = {};
  for (const [member, { field, kind }] of Records.toEntries(SCALARS)) {
    const value = data[member];
    if (value !== undefined)
      props[field] = [
        kind === "text"
          ? { t: "str", v: String(value) }
          : { t: "ref", v: value === true ? SHORTCUT_IDS.required : SHORTCUT_IDS.excluded },
      ];
  }
  const key = data.key;
  if (key !== undefined) {
    const printable = typeof key !== "string" && "kind" in key;
    props[SHORTCUT_IDS.matcher] = [
      { t: "ref", v: printable ? SHORTCUT_IDS.printable : SHORTCUT_IDS.keySet },
    ];
    props[printable ? SHORTCUT_IDS.except : SHORTCUT_IDS.characters] = (
      typeof key === "string" ? [key] : printable ? key.except : key
    ).map((v) => ({ t: "str", v }));
  }
  return node(id, describeChord(chord), SHORTCUT_IDS.chord, at, props);
}

const Strings = Schema.Array(Schema.Struct({ t: Schema.Literal("str"), v: Schema.String }));
const readStrings = Schema.decodeUnknownOption(Strings);
const readData = Schema.decodeUnknownOption(ChordDataSchema);

/** Scalar fields keep their declared graph carrier and cardinality. */
function scalarData(value: NodeLike): Record<string, unknown> | null {
  const data: Record<string, unknown> = {};
  for (const [member, { field, kind }] of Records.toEntries(SCALARS)) {
    const values = value.props[field] ?? [];
    if (values.length === 0) continue;
    const scalar = values[0];
    if (values.length !== 1 || scalar?.t !== (kind === "text" ? "str" : "ref")) return null;
    if (kind === "text") data[member] = scalar.v;
    else if (scalar.v === SHORTCUT_IDS.required) data[member] = true;
    else if (scalar.v === SHORTCUT_IDS.excluded) data[member] = false;
    else return null;
  }
  return data;
}

/** The key matcher is a sum: an exact set, printable exclusions, or unconstrained. */
function keyData(value: NodeLike): Option.Option<ChordData["key"]> {
  const matcher = refValuesOf(value, SHORTCUT_IDS.matcher);
  if (matcher.length !== (value.props[SHORTCUT_IDS.matcher] ?? []).length || matcher.length > 1)
    return Option.none();
  const characters = readStrings(value.props[SHORTCUT_IDS.characters] ?? []);
  const except = readStrings(value.props[SHORTCUT_IDS.except] ?? []);
  if (Option.isNone(characters) || Option.isNone(except)) return Option.none();
  if (matcher[0] === SHORTCUT_IDS.keySet && except.value.length === 0)
    return Option.some(characters.value.map(({ v }) => v));
  if (matcher[0] === SHORTCUT_IDS.printable && characters.value.length === 0)
    return Option.some({ kind: "printable", except: except.value.map(({ v }) => v) });
  return matcher.length === 0 && characters.value.length === 0 && except.value.length === 0
    ? Option.some(undefined)
    : Option.none();
}

/** Imported malformed values are inert too: carrier, cardinality and codec must all agree. */
export function chordOfNode(value: NodeLike): ChordData | null {
  const data = scalarData(value);
  const key = keyData(value);
  if (data === null || Option.isNone(key)) return null;
  const decoded = readData({ ...data, ...(key.value === undefined ? {} : { key: key.value }) });
  return Option.isSome(decoded) ? chordData(decoded.value) : null;
}

/** Shortcut rows are filed under the family; each chord lives under its binding. */
export function keyboardRootIds(family: string, definition: KeyboardDefinition): string[] {
  return [
    ...keyboardIn(family, definition).bindings.map(({ id }) => shortcutNodeId(id)),
    ...new Set(
      (definition.bindings ?? []).flatMap(({ value }) =>
        "action" in value.run ? [keyTargetNodeId(family, value.context, value.run)] : [],
      ),
    ),
  ];
}

/** Defaults are descriptions of the declaration, never a second source of runtime bindings. */
export function keyboardNodes(
  family: string,
  definition: KeyboardDefinition,
  at: string,
): KbNode[] {
  const calls = new Map<string, KbNode>();
  const bindings = (definition.bindings ?? []).flatMap(({ id, value }) => {
    const binding = namespaced(family, id);
    const target = keyTargetNodeId(family, value.context, value.run);
    if ("action" in value.run) {
      const call = normalizedCall(value.run);
      calls.set(
        target,
        node(target, call.action, SHORTCUT_IDS.call, at, {
          [SHORTCUT_IDS.action]: [{ t: "str", v: call.action }],
          [SHORTCUT_IDS.input]: [{ t: "str", v: canonicalJson(call.input) }],
        }),
      );
    }
    const chord = chordNode(`sys.shortcut.chord.${binding}`, value.chord, at);
    const description = node(shortcutNodeId(binding), id, SHORTCUT_IDS.tag, at, {
      [SHORTCUT_IDS.keys]: [{ t: "ref", v: chord.id }],
      [SHORTCUT_IDS.runs]: [{ t: "ref", v: target }],
      [SHORTCUT_IDS.where]: [{ t: "ref", v: keyContextNodeId(value.context) }],
      [SHORTCUT_IDS.enabled]: [{ t: "bool", v: true }],
      ...(value.replaces === undefined
        ? {}
        : { [SHORTCUT_IDS.replaces]: [{ t: "ref", v: shortcutNodeId(value.replaces) }] }),
    });
    description.children = [chord.id];
    return [chord, description];
  });
  return [...bindings, ...calls.values()];
}

/** Context and run choices join the existing declared-option fold, like views and backdrops. */
export function keyboardOptions(
  family: string,
  definition: KeyboardDefinition,
): readonly DeclaredOptionSet[] {
  const qualified = keyboardIn(family, definition);
  return [
    {
      kind: KEY_CONTEXT_OPTIONS,
      options: qualified.contexts.map(({ id }) => ({
        id,
        label: id,
      })),
    },
    {
      kind: KEY_INTENT_OPTIONS,
      options: qualified.contexts.flatMap(({ id, value }) =>
        [...new Set(value.intents)].map((intent) => ({
          id: intentKey(id, intent),
          label: `${id}: ${intent}`,
        })),
      ),
    },
  ];
}
