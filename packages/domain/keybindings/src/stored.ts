/** Ordinary shortcut rows resolve identities from the loaded catalog, never from writable provenance. */
import type { ChordData } from "./chord-data.ts";
import { chordFromText } from "./chord-text.ts";
import { admitKeymaps } from "./bindings.ts";
import { Encoding, Schema } from "effect";
import { hash } from "fast-sha256";
import {
  canonicalJson,
  present,
  SYSTEM_IDS,
  tagChains,
  type TagChains,
  type NodeLike,
} from "@kb/model";
import type { Contribution } from "@kb/plugin";
import type { Keybinding, KeyContext, KeyRun, RefusedBinding } from "./bindings.ts";
import {
  callOfNode,
  normalizedCall,
  chordData,
  keyTargetNodeId,
  shortcutNodeId,
  SHORTCUT_IDS,
} from "./nodes.ts";

/** Every stored row has this owner, independently of who or what wrote it. */
export const STORED_KEY_OWNER = "kb:stored-shortcuts";

/** Supplied by the live code catalog, never by graph fields. */
interface KeySource {
  readonly provider: string;
  readonly implementation: string;
}
interface RegisteredKeyTarget {
  readonly id: string;
  readonly source: KeySource;
}
export interface KeyboardRegistrations {
  readonly contexts: readonly KeyContext[];
  readonly bindings: readonly Contribution<Keybinding>[];
  // GAP [[01M76AZFNNGRS5P55CSCG93YJM]] code-image identity is parked; shortcut overrides use person/content confirmation
  readonly source: (owner: string) => KeySource | undefined;
  /** Actual eligible membership in the normal runner catalog, including host-derived commands. */
  readonly command: (id: string) => RegisteredKeyTarget | undefined;
  /** Actual live action registration, resolving aliases through the catalog's normal lookup. */
  readonly action: (id: string) => RegisteredKeyTarget | undefined;
}

export interface StoredKeybinding {
  readonly nodeId: string;
  readonly contributions: readonly Contribution<Keybinding>[];
  /** Exact normalized review content, excluding cosmetic labels and the enable switch. */
  readonly review: string;
  /** Person confirmation covers data semantics, independently of code provenance or labels. */
  readonly content: string;
}

interface StoredKeybindings {
  readonly candidates: readonly StoredKeybinding[];
  readonly refused: readonly RefusedBinding[];
}

const Ref = Schema.Struct({ t: Schema.Literal("ref"), v: Schema.String });
const RefField = Schema.Array(Ref).pipe(Schema.check(Schema.isMaxLength(1)));
const readRef = Schema.decodeUnknownSync(RefField);
const Enabled = Schema.Array(Schema.Struct({ t: Schema.Literal("bool"), v: Schema.Boolean })).pipe(
  Schema.check(Schema.isMaxLength(1)),
);
const readEnabled = Schema.decodeUnknownSync(Enabled);
const readJson = Schema.decodeUnknownSync(Schema.Json);

function reference(node: NodeLike, field: string): string | undefined {
  return readRef(node.props[field] ?? [])[0]?.v;
}

function contributionId(nodeId: string): string {
  return `${STORED_KEY_OWNER}:${nodeId}`;
}

interface KeyReading {
  readonly nodesById: ReadonlyMap<string, NodeLike>;
  readonly kinds: TagChains;
  readonly contexts: ReadonlyMap<string, KeyContext>;
  readonly intents: ReadonlyMap<string, { readonly context: KeyContext; readonly intent: string }>;
  readonly defaults: ReadonlyMap<string, Contribution<Keybinding>>;
  readonly registrations: KeyboardRegistrations;
}

/** Resolve a call through the catalog, including the implementation currently elected for it. */
function registeredRun(run: KeyRun, context: KeyContext, reading: KeyReading) {
  if ("intent" in run) {
    const source = reading.registrations.source(context.owner);
    return source === undefined || !context.intents.includes(run.intent)
      ? undefined
      : { id: keyTargetNodeId("", context.id, run), source, run };
  }
  const target =
    "command" in run
      ? reading.registrations.command(run.command)
      : reading.registrations.action(run.action);
  return target === undefined
    ? undefined
    : { ...target, run: "action" in run ? normalizedCall(run) : run };
}

function resolvedTarget(referenceId: string, context: KeyContext, reading: KeyReading) {
  const intent = reading.intents.get(referenceId);
  if (intent !== undefined) {
    if (intent.context.id !== context.id) throw new Error("that intent belongs to another context");
    return registeredRun({ intent: intent.intent }, context, reading);
  }
  const command = registeredRun({ command: referenceId }, context, reading);
  if (command !== undefined) return command;
  const row = reading.nodesById.get(referenceId);
  const call =
    row === undefined || !reading.kinds.isA(row, SHORTCUT_IDS.call) ? null : callOfNode(row);
  if (call === null) return undefined;
  return registeredRun(call, context, reading);
}

function nativeHolder(referenceId: string, reading: KeyReading): Schema.Json {
  const holder = reading.defaults.get(referenceId);
  if (holder === undefined) return null;
  const source = reading.registrations.source(holder.owner);
  if (source === undefined)
    throw new Error("replacement holder is unavailable in the live catalog");
  const { context, chord, run, replaces } = holder.value;
  const heldContext = reading.contexts.get(context);
  const target = heldContext === undefined ? undefined : registeredRun(run, heldContext, reading);
  if (target === undefined)
    throw new Error("replacement holder target is unavailable in the live catalog");
  return {
    id: holder.id,
    source: { ...source },
    context,
    target: { id: target.id, source: { ...target.source } },
    chord: readJson(chordData(chord)),
    run: readJson("action" in run ? normalizedCall(run) : run),
    ...(replaces === undefined ? {} : { replaces }),
  };
}

const readKeyTexts = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ t: Schema.Literal("str"), v: Schema.String })),
);

interface ShortcutDefinition {
  readonly row: NodeLike;
  readonly context: KeyContext;
  readonly target: NonNullable<ReturnType<typeof resolvedTarget>>;
  readonly chords: readonly ChordData[];
  readonly parent: string | undefined;
  readonly content: string;
  readonly reviewData: Schema.JsonObject;
}

function definitionOf(row: NodeLike, reading: KeyReading): ShortcutDefinition {
  const targetRef = reference(row, SHORTCUT_IDS.runs);
  const command = targetRef === undefined ? undefined : reading.nodesById.get(targetRef);
  if (
    command === undefined ||
    targetRef === undefined ||
    !reading.kinds.isA(command, SYSTEM_IDS.command)
  )
    throw new Error("runs must name a command");
  const text = (node: NodeLike, field: string) => {
    const values = readKeyTexts(node.props[field] ?? []);
    if (values.length > 1) throw new Error(`${field} requires one value`);
    return values[0]?.v;
  };
  const bound = text(command, SHORTCUT_IDS.commandContext);
  const where = text(row, SHORTCUT_IDS.where) ?? bound;
  const context = where === undefined ? undefined : reading.contexts.get(where);
  if (context === undefined || (bound !== undefined && bound !== context.id))
    throw new Error("command context must name the loaded context in which this shortcut runs");
  const target = resolvedTarget(targetRef, context, reading);
  const source = reading.registrations.source(context.owner);
  if (target === undefined || source === undefined)
    throw new Error("runs target is unavailable in the live catalog");
  const keys = readKeyTexts(row.props[SHORTCUT_IDS.keys] ?? []);
  if (keys.length === 0) throw new Error("keys must contain at least one chord");
  const distinct = new Map<string, ChordData>();
  for (const { v } of keys) {
    const chord = chordFromText(v);
    if (chord === null) throw new Error(`Invalid chord: ${v}`);
    distinct.set(canonicalJson(chord), chord);
  }
  const chords = [...distinct]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, chord]) => chord);
  const parent = reference(row, SHORTCUT_IDS.replaces);
  const run = readJson(target.run);
  const semantics = {
    context: context.id,
    chords: readJson(chords),
    target: { reference: targetRef, id: target.id, run },
    replaces: parent ?? null,
  };
  return {
    row,
    context,
    target,
    chords,
    parent,
    content: canonicalJson({ format: "kb.shortcut.confirmation.v2", ...semantics }),
    reviewData: {
      id: row.id,
      provider: STORED_KEY_OWNER,
      ...semantics,
      source: { ...source },
      targetSource: { ...target.source },
    },
  };
}

function componentOf(definition: ShortcutDefinition, chord: ChordData): Contribution<Keybinding> {
  return {
    id: `${contributionId(definition.row.id)}:${reviewDigest(readJson(chord))}`,
    aliases: [],
    owner: `${STORED_KEY_OWNER}/${definition.row.id}`,
    value: { context: definition.context.id, chord, run: definition.target.run },
  };
}

interface PreparedKeybinding {
  readonly contribution: Contribution<Keybinding>;
  readonly reviewData: Schema.JsonObject;
}

interface ReviewDependency {
  readonly id: string;
  readonly data: Schema.Json;
  readonly parent: string | undefined;
}

function reviewDigest(data: Schema.Json): string {
  return Encoding.encodeHex(hash(new TextEncoder().encode(canonicalJson(data))));
}

/** Machine-local confirmation is scoped to the root, row and exact normalized binding. */
export function shortcutConfirmation(root: string, candidate: StoredKeybinding): string {
  return `sha256:${reviewDigest({
    format: "kb.shortcut.confirmation-key.v1",
    root,
    node: candidate.nodeId,
    content: candidate.content,
  })}`;
}

/** Each local definition is hashed once; parent identities never embed serialized reviews. */
function holderIdentity(
  stored: ReadonlyMap<string, PreparedKeybinding>,
  reading: KeyReading,
): (id: string) => string {
  const identities = new Map<string, string>();
  const dependency = (id: string): ReviewDependency => {
    const row = stored.get(id);
    if (row !== undefined)
      return {
        id,
        data: { kind: "stored", definition: row.reviewData },
        parent: row.contribution.value.replaces,
      };
    const native = reading.defaults.get(id);
    return {
      id,
      data:
        native === undefined
          ? { kind: "missing" }
          : { kind: "native", definition: nativeHolder(id, reading) },
      parent: native?.value.replaces,
    };
  };
  return (id) => {
    const path: ReviewDependency[] = [];
    const positions = new Map<string, number>();
    let next: string | undefined = id;
    while (next !== undefined && !identities.has(next) && !positions.has(next)) {
      positions.set(next, path.length);
      const entry = dependency(next);
      path.push(entry);
      next = entry.parent;
    }
    const cycleStart = next === undefined ? undefined : positions.get(next);
    if (cycleStart !== undefined) {
      // A component digest covers every edge and definition, independent of the traversal start.
      const cycle = path
        .splice(cycleStart)
        .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const component = reviewDigest({
        domain: "kb.shortcut.cycle.v1",
        members: cycle.map(({ id: member, data, parent }) => ({
          id: member,
          data,
          parent: parent ?? null,
        })),
      });
      for (const member of cycle)
        identities.set(
          member.id,
          reviewDigest({ domain: "kb.shortcut.cycle-member.v1", component, id: member.id }),
        );
    }
    for (const entry of path.toReversed())
      identities.set(
        entry.id,
        reviewDigest({
          domain: "kb.shortcut.holder.v1",
          id: entry.id,
          data: entry.data,
          parent: entry.parent === undefined ? null : (identities.get(entry.parent) ?? null),
        }),
      );
    const identity = identities.get(id);
    if (identity === undefined) throw new Error(`Unresolved replacement identity: ${id}`);
    return identity;
  };
}

function dependencyOrder(
  definitions: ReadonlyMap<string, ShortcutDefinition>,
): ShortcutDefinition[] {
  const pending = new Map([...definitions].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const ordered: ShortcutDefinition[] = [];
  while (pending.size > 0) {
    const next =
      [...pending].find(
        ([, definition]) => definition.parent === undefined || !pending.has(definition.parent),
      ) ?? pending.entries().next().value;
    if (next === undefined) break;
    ordered.push(next[1]);
    pending.delete(next[0]);
  }
  return ordered;
}

/** Alternate keys become atomic registrations through the existing admission model. */
function lowerKeyComponents(
  definitions: readonly ShortcutDefinition[],
  reading: KeyReading,
  refused: RefusedBinding[],
) {
  const { registrations } = reading;
  const nativeGroups = new Map<string, Contribution<Keybinding>[]>();
  for (const binding of registrations.bindings) {
    const id = binding.value.shortcut;
    if (id === undefined) continue;
    nativeGroups.set(id, [...(nativeGroups.get(id) ?? []), binding]);
  }
  const components = new Map(
    definitions.map((definition) => [
      definition.row.id,
      definition.chords.map((chord) => componentOf(definition, chord)),
    ]),
  );
  const prepared = new Map<string, PreparedKeybinding>();
  const held: Contribution<Keybinding>[] = [...registrations.bindings];
  for (const definition of definitions) {
    const linked: Contribution<Keybinding>[] = [];
    for (const bare of components.get(definition.row.id) ?? []) {
      let contribution = bare;
      if (definition.parent !== undefined) {
        const holders = nativeGroups.get(definition.parent) ?? components.get(definition.parent);
        if (holders === undefined || holders.length === 0) {
          refused.push({ id: definition.row.id, reason: "replaces must name a loaded shortcut" });
          linked.length = 0;
          break;
        }
        const options = holders
          .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((holder) => ({ ...bare, value: { ...bare.value, replaces: holder.id } }));
        // The existing admission decides which component this press may take. No second overlap policy.
        contribution =
          options.find(
            (candidate) =>
              admitKeymaps(registrations.contexts, [...held, ...linked, candidate], () => true)
                .get(candidate.value.context)
                ?.held.some((binding) => binding.id === candidate.id) === true,
          ) ?? present(options[0], "replacement component");
      }
      linked.push(contribution);
    }
    components.set(definition.row.id, linked);
    held.push(...linked);
    const definitionIdentity = reviewDigest(definition.reviewData);
    for (const contribution of linked)
      prepared.set(contribution.id, {
        contribution,
        reviewData: {
          definition: definitionIdentity,
          chord: readJson(chordData(contribution.value.chord)),
        },
      });
  }
  return { components, prepared };
}

/** Read one row per action, then lower its alternate keys through ordinary atomic admission. */
export function storedKeybindings(
  nodes: readonly NodeLike[],
  registrations: KeyboardRegistrations,
): StoredKeybindings {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const kinds = tagChains((id) => nodesById.get(id));
  const contexts = new Map(registrations.contexts.map((context) => [context.id, context]));
  const intents = new Map(
    registrations.contexts.flatMap((context) =>
      context.intents.map(
        (intent) => [keyTargetNodeId("", context.id, { intent }), { context, intent }] as const,
      ),
    ),
  );
  const defaults = new Map(registrations.bindings.map((binding) => [binding.id, binding]));
  const enabled = new Map<string, NodeLike>();
  const refused: RefusedBinding[] = [];
  for (const row of nodes) {
    if (row.id.startsWith(shortcutNodeId("")) || !kinds.isA(row, SHORTCUT_IDS.tag)) continue;
    try {
      if (readEnabled(row.props[SHORTCUT_IDS.enabled] ?? [])[0]?.v === true)
        enabled.set(row.id, row);
    } catch {
      refused.push({ id: row.id, reason: "enabled must be one checkbox value" });
    }
  }
  const reading: KeyReading = { nodesById, kinds, contexts, intents, defaults, registrations };
  const definitions = new Map<string, ShortcutDefinition>();
  for (const row of enabled.values()) {
    try {
      definitions.set(row.id, definitionOf(row, reading));
    } catch (error) {
      refused.push({ id: row.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const ordered = dependencyOrder(definitions);
  const { components, prepared } = lowerKeyComponents(ordered, reading, refused);
  const identityOf = holderIdentity(prepared, reading);
  const candidates: StoredKeybinding[] = [];
  for (const definition of ordered) {
    const contributions = components.get(definition.row.id) ?? [];
    if (contributions.length === 0) continue;
    try {
      candidates.push({
        nodeId: definition.row.id,
        contributions,
        content: definition.content,
        review: canonicalJson({
          format: "kb.shortcut.v2",
          binding: definition.reviewData,
          components: contributions.map((binding) => ({
            id: binding.id,
            holder:
              binding.value.replaces === undefined ? null : identityOf(binding.value.replaces),
          })),
        }),
      });
    } catch (error) {
      refused.push({
        id: definition.row.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    candidates,
    refused: refused.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
