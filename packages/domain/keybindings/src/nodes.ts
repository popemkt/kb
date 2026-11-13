/** Keyboard data as ordinary nodes; executable targets remain registered code. */
export { chordData } from "./chord-data.ts";
import { Option, Schema } from "effect";
import {
  canonicalJson,
  seededField,
  seededTag,
  seededCommand,
  SYSTEM_IDS,
  type KbNode,
  type NodeLike,
} from "@kb/model";
import { chordToText } from "./chord-text.ts";
import {
  keyboardIn,
  type ActionCall,
  type KeyRun,
  type KeyboardDefinition,
  type Keybinding,
} from "./bindings.ts";

export const SHORTCUT_IDS = {
  tag: "sys.shortcut",
  parent: "sys.shortcuts",
  commandContext: "sys.f.command.context",
  commandIntent: "sys.f.command.intent",
  call: "sys.call",
  action: "sys.f.call.action",
  input: "sys.f.call.input",
  keys: "sys.f.shortcut.keys",
  runs: "sys.f.shortcut.runs",
  where: "sys.f.shortcut.where",
  enabled: "sys.f.shortcut.enabled",
  replaces: "sys.f.shortcut.replaces",
} as const;

export function shortcutNodeId(binding: string): string {
  return `sys.shortcut.binding.${binding}`;
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
  if ("intent" in run) return `sys.cmd.keyboard.${intentKey(context, run.intent)}`;
  if ("command" in run) return run.command;
  // Recipes belong to their declaring family, like its other seeded data. Within that
  // declaration equal calls share one recipe, independently of the binding ids.
  return `sys.call.generated.${encodeURIComponent(family)}:${encodeURIComponent(canonicalJson(normalizedCall(run)))}`;
}

/** The same ordinary recipe codec is used for generated and person-authored calls. */
export function callNode(id: string, call: ActionCall, at: string): KbNode {
  const normalized = normalizedCall(call);
  return node(id, normalized.action, SHORTCUT_IDS.call, at, {
    [SHORTCUT_IDS.action]: [{ t: "str", v: normalized.action }],
    [SHORTCUT_IDS.input]: [{ t: "str", v: canonicalJson(normalized.input) }],
  });
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

/** The lean graph schema: shortcuts carry key text; commands carry execution context. */
export function keyboardSchemaNodes(at: string): KbNode[] {
  const call = seededTag(SHORTCUT_IDS.call, "call", [SHORTCUT_IDS.action, SHORTCUT_IDS.input], at);
  call.props[SYSTEM_IDS.extendsField] = [{ t: "ref", v: SYSTEM_IDS.command }];
  return [
    node(SHORTCUT_IDS.parent, "Shortcuts", null, at),
    call,
    seededField(SHORTCUT_IDS.action, "action", "text", at, { one: true }),
    seededField(SHORTCUT_IDS.input, "input", "text", at, { one: true }),
    seededField(SHORTCUT_IDS.commandContext, "command context", "text", at, { one: true }),
    seededField(SHORTCUT_IDS.commandIntent, "context command", "text", at, { one: true }),
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
    seededField(SHORTCUT_IDS.keys, "keys", "text", at),
    seededField(SHORTCUT_IDS.runs, "runs", "ref", at, {
      one: true,
      props: {
        [SYSTEM_IDS.targetQueryField]: [
          {
            t: "str",
            v: `[:find ?id :where [?n :node/id ?id] [?t :node/id "${SYSTEM_IDS.command}"] [?n :node/is ?t]]`,
          },
        ],
      },
    }),
    seededField(SHORTCUT_IDS.where, "where", "text", at, { one: true }),
    seededField(SHORTCUT_IDS.replaces, "replaces", "ref", at, {
      one: true,
      props: { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: SHORTCUT_IDS.tag }] },
    }),
    seededField(SHORTCUT_IDS.enabled, "enabled", "checkbox", at, { one: true }),
  ];
}

const Strings = Schema.Array(Schema.Struct({ t: Schema.Literal("str"), v: Schema.String }));
const readStrings = Schema.decodeUnknownOption(Strings);

/** Malformed imported recipes are inert; JSON text is never spread or partially decoded. */
export function callOfNode(value: NodeLike): ActionCall | null {
  const action = readStrings(value.props[SHORTCUT_IDS.action] ?? []);
  const input = readStrings(value.props[SHORTCUT_IDS.input] ?? []);
  if (
    Option.isNone(action) ||
    Option.isNone(input) ||
    action.value.length !== 1 ||
    input.value.length > 1
  )
    return null;
  const id = action.value[0]?.v;
  if (id === undefined) return null;
  try {
    return normalizedCall({
      action: id,
      input: input.value[0] === undefined ? {} : JSON.parse(input.value[0].v),
    });
  } catch {
    return null;
  }
}

/** Alternate keys share a semantic call, while context-specific executions stay distinct. */
function keyboardGroups(family: string, definition: KeyboardDefinition) {
  const groups = new Map<
    string,
    {
      context: string;
      target: string;
      run: KeyRun;
      bindings: { id: string; value: Keybinding }[];
    }
  >();
  for (const binding of keyboardIn(family, definition).bindings) {
    const { context, run } = binding.value;
    const target = keyTargetNodeId(family, context, run);
    const key = canonicalJson([context, target]);
    const group = groups.get(key) ?? { context, target, run, bindings: [] };
    group.bindings.push(binding);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** One shortcut per context/call; all alternate native registrations remain its components. */
export function shortcutGroupId(family: string, context: string, target: string): string {
  return shortcutNodeId(
    `${encodeURIComponent(family)}:${encodeURIComponent(context)}:${encodeURIComponent(target)}`,
  );
}

/** The shared shortcut list contains only shortcuts; executable descriptions stay with their owner. */
export function keyboardShortcutIds(family: string, definition: KeyboardDefinition): string[] {
  return keyboardGroups(family, definition).map((group) =>
    shortcutGroupId(family, group.context, group.target),
  );
}

export function keyboardCommandIds(family: string, definition: KeyboardDefinition): string[] {
  const shortcuts = new Set(keyboardShortcutIds(family, definition));
  return keyboardNodes(family, definition, "")
    .filter((row) => !shortcuts.has(row.id))
    .map(({ id }) => id);
}

function keyboardLabel(id: string): string {
  const words = id.replaceAll(/[.-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Commands are graph identities; native registrations remain the sole default dispatch source. */
export function keyboardNodes(
  family: string,
  definition: KeyboardDefinition,
  at: string,
): KbNode[] {
  const commands = new Map<string, KbNode>();
  for (const { id: context, value } of keyboardIn(family, definition).contexts) {
    for (const intent of new Set(value.intents)) {
      const id = keyTargetNodeId(family, context, { intent });
      const command = seededCommand(id, keyboardLabel(intent), at);
      command.props[SHORTCUT_IDS.commandContext] = [{ t: "str", v: context }];
      command.props[SHORTCUT_IDS.commandIntent] = [{ t: "str", v: intent }];
      commands.set(id, command);
    }
  }
  const shortcuts = keyboardGroups(family, definition).map((group) => {
    if ("action" in group.run) commands.set(group.target, callNode(group.target, group.run, at));
    return node(
      shortcutGroupId(family, group.context, group.target),
      keyboardLabel(
        "intent" in group.run
          ? group.run.intent
          : "command" in group.run
            ? (group.run.command.split(".").at(-1) ?? group.run.command)
            : group.run.action,
      ),
      SHORTCUT_IDS.tag,
      at,
      {
        [SHORTCUT_IDS.keys]: [
          ...new Set(group.bindings.map(({ value }) => chordToText(value.chord))),
        ].map((v) => ({ t: "str", v })),
        [SHORTCUT_IDS.runs]: [{ t: "ref", v: group.target }],
        ...("intent" in group.run
          ? {}
          : { [SHORTCUT_IDS.where]: [{ t: "str", v: group.context }] }),
        [SHORTCUT_IDS.enabled]: [{ t: "bool", v: true }],
      },
    );
  });
  return [...shortcuts, ...commands.values()];
}
