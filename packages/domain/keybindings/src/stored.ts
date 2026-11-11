/** Ordinary shortcut rows resolve identities from the loaded catalog, never from writable provenance. */
import { Encoding, Schema } from "effect";
import { hash } from "fast-sha256";
import { canonicalJson, tagChains, type TagChains, type NodeLike } from "@kb/model";
import type { Contribution } from "@kb/plugin";
import type { Keybinding, KeyContext, KeyRun, RefusedBinding } from "./bindings.ts";
import {
  callOfNode,
  normalizedCall,
  chordData,
  chordOfNode,
  keyContextNodeId,
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
  // GAP [[01M76AZFNNGRS5P55CSCG93YJM]] checkout identity needs a loaded-module manifest, not a cache fingerprint
  readonly source: (owner: string) => KeySource | undefined;
  /** Actual eligible membership in the normal runner catalog, including host-derived commands. */
  readonly command: (id: string) => RegisteredKeyTarget | undefined;
  /** Actual live action registration, resolving aliases through the catalog's normal lookup. */
  readonly action: (id: string) => RegisteredKeyTarget | undefined;
}

interface StoredKeybinding {
  readonly nodeId: string;
  readonly contribution: Contribution<Keybinding>;
  /** Exact normalized review content, excluding cosmetic labels and the enable switch. */
  readonly review: string;
}

export interface StoredKeybindings {
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
  readonly graph: ReadonlyMap<string, NodeLike>;
  readonly kinds: TagChains;
  readonly contexts: ReadonlyMap<string, KeyContext>;
  readonly intents: ReadonlyMap<string, { readonly context: KeyContext; readonly intent: string }>;
  readonly defaults: ReadonlyMap<string, Contribution<Keybinding>>;
  readonly enabled: ReadonlyMap<string, NodeLike>;
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
  const row = reading.graph.get(referenceId);
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
    throw new Error("replacement holder is unsupported by the authority host");
  const { context, chord, run, replaces } = holder.value;
  const heldContext = reading.contexts.get(keyContextNodeId(context));
  const target = heldContext === undefined ? undefined : registeredRun(run, heldContext, reading);
  if (target === undefined)
    throw new Error("replacement holder target is unavailable or unsupported");
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

function chordFor(row: NodeLike, reading: KeyReading) {
  const key = reference(row, SHORTCUT_IDS.keys);
  const chordNode = key === undefined ? undefined : reading.graph.get(key);
  const chord =
    chordNode === undefined || !reading.kinds.isA(chordNode, SHORTCUT_IDS.chord)
      ? null
      : chordOfNode(chordNode);
  if (chord === null) throw new Error("keys must name a valid key chord");
  return chord;
}

interface PreparedKeybinding extends Omit<StoredKeybinding, "review"> {
  readonly reviewData: Schema.JsonObject;
}

function candidateOf(row: NodeLike, reading: KeyReading): PreparedKeybinding {
  const contextRef = reference(row, SHORTCUT_IDS.where);
  const context = contextRef === undefined ? undefined : reading.contexts.get(contextRef);
  if (context === undefined || contextRef === undefined || !reading.graph.has(contextRef))
    throw new Error("where must name a loaded key context");
  const targetRef = reference(row, SHORTCUT_IDS.runs);
  const target = targetRef === undefined ? undefined : resolvedTarget(targetRef, context, reading);
  const contextSource = reading.registrations.source(context.owner);
  if (
    target === undefined ||
    contextSource === undefined ||
    targetRef === undefined ||
    !reading.graph.has(targetRef)
  )
    throw new Error("runs target is unavailable or unsupported by the authority host");
  const chord = chordFor(row, reading);
  const replacesRef = reference(row, SHORTCUT_IDS.replaces);
  const replaces =
    replacesRef === undefined
      ? undefined
      : (reading.defaults.get(replacesRef)?.id ??
        (reading.enabled.has(replacesRef) ? contributionId(replacesRef) : undefined));
  if (replacesRef !== undefined && replaces === undefined)
    throw new Error("replaces must name a loaded holder or an enabled shortcut");
  const value: Keybinding = {
    context: context.id,
    chord,
    run: target.run,
    ...(replaces === undefined ? {} : { replaces }),
  };
  // The registered call's complete JSON semantics participate, including action inputs.
  const run = readJson(target.run);
  const reviewData = {
    id: row.id,
    provider: STORED_KEY_OWNER,
    context: {
      id: context.id,
      source: { ...contextSource },
      reach: context.reach,
      intents: [...new Set(context.intents)].toSorted(),
      reserved: context.reserved.map(chordData),
    },
    chord: chordData(chord),
    target: { reference: targetRef, id: target.id, source: { ...target.source }, run },
    ...(replacesRef === undefined ? {} : { replaces: replacesRef }),
  };
  return {
    nodeId: row.id,
    contribution: {
      id: contributionId(row.id),
      aliases: [],
      owner: `${STORED_KEY_OWNER}/${row.id}`,
      value,
    },
    reviewData,
  };
}

interface ReviewDependency {
  readonly id: string;
  readonly data: Schema.Json;
  readonly parent: string | undefined;
}

function reviewDigest(data: Schema.Json): string {
  return Encoding.encodeHex(hash(new TextEncoder().encode(canonicalJson(data))));
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
    const native = reading.defaults.get(shortcutNodeId(id));
    return {
      id,
      data:
        native === undefined
          ? { kind: "missing" }
          : { kind: "native", definition: nativeHolder(shortcutNodeId(id), reading) },
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

/** Resolve a complete snapshot afresh; ordering depends on identity and replacement edges, not enumeration. */
export function storedKeybindings(
  nodes: readonly NodeLike[],
  registrations: KeyboardRegistrations,
): StoredKeybindings {
  const graph = new Map(nodes.map((node) => [node.id, node]));
  const kinds = tagChains((id) => graph.get(id));
  const contexts = new Map(
    registrations.contexts.map((context) => [keyContextNodeId(context.id), context]),
  );
  const intents = new Map(
    registrations.contexts.flatMap((context) =>
      context.intents.map(
        (intent) => [keyTargetNodeId("", context.id, { intent }), { context, intent }] as const,
      ),
    ),
  );
  const defaults = new Map(
    registrations.bindings.map((binding) => [shortcutNodeId(binding.id), binding]),
  );
  const rows = nodes.filter(
    (node) => !node.id.startsWith(shortcutNodeId("")) && kinds.isA(node, SHORTCUT_IDS.tag),
  );
  const enabled = new Map<string, NodeLike>();
  const refused: RefusedBinding[] = [];
  for (const row of rows) {
    try {
      if (readEnabled(row.props[SHORTCUT_IDS.enabled] ?? [])[0]?.v === true)
        enabled.set(row.id, row);
    } catch {
      refused.push({ id: row.id, reason: "enabled must be one checkbox value" });
    }
  }
  const candidates = new Map<string, PreparedKeybinding>();
  const reading: KeyReading = { graph, kinds, contexts, intents, defaults, enabled, registrations };
  for (const row of enabled.values()) {
    try {
      candidates.set(row.id, candidateOf(row, reading));
    } catch (error) {
      refused.push({ id: row.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const pending = new Map([...candidates].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const ordered: PreparedKeybinding[] = [];
  while (pending.size > 0) {
    const ready = [...pending].find(([, candidate]) => {
      const parent = candidate.contribution.value.replaces;
      return (
        parent === undefined ||
        ![...pending.values()].some((other) => other.contribution.id === parent)
      );
    });
    // Cycles and their dependents stay deterministic and inert under the ordinary missing-holder rule.
    const next = ready ?? pending.entries().next().value;
    if (next === undefined) break;
    ordered.push(next[1]);
    pending.delete(next[0]);
  }
  const byId = new Map(
    [...candidates.values()].map((candidate) => [candidate.contribution.id, candidate]),
  );
  const identityOf = holderIdentity(byId, reading);
  const reviewed: StoredKeybinding[] = [];
  for (const prepared of ordered) {
    try {
      reviewed.push({
        nodeId: prepared.nodeId,
        contribution: prepared.contribution,
        review: canonicalJson({
          format: "kb.shortcut.v1",
          binding: prepared.reviewData,
          holder:
            prepared.contribution.value.replaces === undefined
              ? null
              : identityOf(prepared.contribution.value.replaces),
        }),
      });
    } catch (error) {
      refused.push({
        id: prepared.nodeId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    candidates: reviewed,
    refused: refused.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
