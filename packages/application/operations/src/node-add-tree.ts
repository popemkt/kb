import { Effect, Predicate } from "effect";
import { z } from "zod";
import { type ActionDefinition, type CaptureTarget, KbCtx, type KbStore } from "@kb/contracts";
import {
  ResolveError,
  cardinalityOf,
  currentIso,
  currentLocalDate,
  declaresOptionSet,
  domainError,
  fieldTypeOf,
  freshId,
  mentionSpans,
  nodeName,
  parseTypedValue,
  present,
  replaceMentions,
  resolveFieldIn,
  type DomainError,
  type FieldType,
  type KbNode,
  type LocalDate,
  type NodeId,
  type NodeGraph,
  type ParsedValue,
  planNodeAdd,
  syncDomain,
  type PropEntry,
} from "@kb/model";
import { OUTLINE_FORMAT_IDS, outlineFormat, type OutlineItem } from "@kb/outline-paste";
import { forcedBy, nodeAddDef } from "./actions.ts";
import { placedGraph, placeOf } from "./place.ts";
import { persistPlannedEffect } from "./session.ts";

export const nodeAddTreeDef = {
  id: "node.addTree",
  title: "Add outline",
  description:
    "Create a whole outline in one transaction from text in an outline format: tana (Tana " +
    "Paste, the default), md (Markdown, read as Tana Paste loosened: * and + bullets, and " +
    "unbulleted lines under an item as its property lines or further text), logseq (as md), " +
    "plain (each line an item, nested by indent, nothing in it a tag or a field) or json (the " +
    "tree node.export writes). The grammar: " +
    "nested `- ` items (indent nests), `#tag` / `#[[multi word tag]]`, `field:: value` " +
    "(or `field::` with nested `- value` items for several values), and `[[ref]]` / " +
    "`[[id|label]]` naming a node id or another item of the same outline by its text. " +
    "Top-level items go under parent at position (the end when omitted); an omitted " +
    "parent puts them where captures go, the capture target (today's node while days is " +
    "on and its captures setting says today), and parent: null at the top level. All or " +
    "nothing; returns the created ids in tree order and each item's line.",
  mode: { kind: "write" } as const,
  targets: ["parent"],
  mints: "ids",
  // Every call is a batch of node.adds: a guard on node.add governs it too,
  // by node.add's own mode.
  batchOf: [nodeAddDef.id],
  inputSchema: z.object({
    outline: z.string(),
    /** The format the outline is written in; html has no reader. */
    format: z.enum(OUTLINE_FORMAT_IDS).optional(),
    parent: z
      .string()
      .nullable()
      .optional()
      .describe(
        "the node its top-level items go under; null for the top level; omitted, the capture target (today's node while days is on)",
      ),
    position: z.number().int().nonnegative().optional(),
    ids: z
      .array(z.string())
      .optional()
      .describe("one id per item in tree order, minted if omitted"),
    /** Bypass sys.* write-guard (browse yes / break no), as node.add's. */
    force: z.boolean().optional(),
  }),
  outputSchema: z.object({
    /** Every created node, in tree order (an item, then its children). */
    ids: z.array(z.string()),
    /** Each item's 1-based source line → the id it was created with. */
    lines: z.record(z.string(), z.string()),
  }),
} satisfies ActionDefinition;

type NodeAddTreeInput = z.infer<typeof nodeAddTreeDef.inputSchema>;
/** An outline add with its place decided: under `parent`, or the top level for null. */
type PlacedTreeInput = Omit<NodeAddTreeInput, "parent"> & { readonly parent: NodeId | null };

/** One item in tree order: its parent's index in that order (null: top level) and its position. */
interface FlatItem {
  item: OutlineItem;
  parentIndex: number | null;
  position: number | undefined;
}

/** One item in tree order with the id it is created with, and the node it goes under. */
interface PlannedItem {
  item: OutlineItem;
  id: NodeId;
  parent: NodeId | undefined;
  position: number | undefined;
}

/**
 * The items in tree order (an item, then its children). Top-level items take
 * consecutive positions from the caller's position, so the outline lands as
 * one block wherever a single `node.add` would have put its first item.
 */
function flatten(items: readonly OutlineItem[], position: number | undefined): FlatItem[] {
  const out: FlatItem[] = [];
  const walk = (list: readonly OutlineItem[], parentIndex: number | null): void => {
    for (const [index, item] of list.entries()) {
      const self = out.length;
      const top = parentIndex === null && position !== undefined;
      out.push({ item, parentIndex, position: top ? position + index : undefined });
      walk(item.children, self);
    }
  };
  walk(items, null);
  return out;
}

/**
 * How an outline names a node in a ref: by an id the graph holds, else by the
 * text of one of the outline's own items (an earlier or a later one — the
 * outline lands at once). A name no item has, or that two items share, is
 * refused; nothing is ever guessed or created for it.
 */
function refResolver(graph: NodeGraph, planned: readonly PlannedItem[]) {
  const byText = new Map<string, NodeId[]>();
  for (const { item, id } of planned) byText.set(item.text, [...(byText.get(item.text) ?? []), id]);
  return (target: string): NodeId => {
    if (graph.has(target)) return target;
    const local = byText.get(target) ?? [];
    const [only] = local;
    if (local.length === 1 && only !== undefined) return only;
    if (local.length > 1) {
      throw new ResolveError(
        "ambiguous",
        `[[${target}]] names ${local.length} items of this outline; link one by its id instead`,
        { ref: target, ids: local },
      );
    }
    throw new ResolveError(
      "not_found",
      `unresolved reference [[${target}]]: no node has that id and no item of this outline has that text`,
      { ref: target },
    );
  };
}

type Resolve = ReturnType<typeof refResolver>;

/** `text` with every ref pointing at its id: an existing id's token is kept as written. */
function linkText(text: string, resolve: Resolve): string {
  return replaceMentions(text, (span) => {
    const id = resolve(span.id);
    return id === span.id ? text.slice(span.start, span.end) : `[[${id}|${span.label ?? span.id}]]`;
  });
}

/** A field's own options, when its options are its children (an option set), each with its name. */
interface FieldOption {
  readonly id: NodeId;
  readonly name: string;
}

function optionsOf(fieldId: NodeId, graph: NodeGraph): readonly FieldOption[] {
  const field = graph.get(fieldId);
  if (!declaresOptionSet(field)) return [];
  const nodeOf = (id: NodeId) => graph.get(id);
  return (field?.children ?? []).map((id) => ({ id, name: nodeName(id, nodeOf) }));
}

/**
 * A bare ref value: an id the graph holds; else, for a field whose options
 * are its children, exactly one option's name, as its picker shows it (a
 * name a person types resolves to an id once, here); else an item of the
 * outline, by its text. A name two options share is refused.
 */
function bareRef(raw: string, resolve: Resolve, graph: NodeGraph, options: readonly FieldOption[]) {
  if (graph.has(raw)) return raw;
  const named = options.filter((option) => option.name === raw.trim());
  const [only] = named;
  if (named.length > 1) {
    throw new ResolveError(
      "ambiguous",
      `${named.length} options are named ${raw.trim()}; name one by its id instead`,
      { option: raw.trim(), ids: named.map((option) => option.id) },
    );
  }
  return only === undefined ? resolve(raw) : only.id;
}

/** What an item's field values are read against. */
interface ValueReading {
  readonly resolve: Resolve;
  readonly graph: NodeGraph;
  /** The field's options, when it is a ref field. */
  readonly options: readonly FieldOption[];
  /** The writer's today, for a relative date. */
  readonly today: LocalDate;
}

/**
 * One field value read as its field's type. A ref field's value is one ref:
 * a whole `[[id]]` / `[[item text]]` token, or a bare id, option name or
 * item text (`bareRef`), resolved like any ref; text around a token is
 * refused, since a ref holds no prose. Every other type reads the text, its
 * refs linked, through the one `parseTypedValue`, a relative date against the
 * writer's `today`.
 */
function readValue(
  raw: string,
  type: FieldType,
  { resolve, graph, options, today }: ValueReading,
): ParsedValue {
  if (type !== "ref") return parseTypedValue(linkText(raw, resolve), type, { today });
  const spans = mentionSpans(raw);
  const [only] = spans;
  if (only === undefined) {
    return { ok: true, value: { t: "ref", v: bareRef(raw, resolve, graph, options) } };
  }
  if (spans.length === 1 && only.start === 0 && only.end === raw.length) {
    return { ok: true, value: { t: "ref", v: resolve(only.id) } };
  }
  return {
    ok: false,
    reason: `a ref value is one [[id]] or [[item text]] token alone, or a bare id or item text: ${raw}`,
  };
}

/** Prefix a failure with the outline line it belongs to. */
const atLine =
  (line: number) =>
  (err: DomainError): DomainError =>
    domainError(err.code, `outline line ${line}: ${err.message}`, {
      line,
      ...(Predicate.isObject(err.details) ? err.details : {}),
    });

/**
 * The outline line a commit's refusal belongs to: the item it names, or the
 * first item when it names the parent the outline is pasted under (only the
 * top level is placed there). Null when it names neither.
 */
function refusedLine(
  err: DomainError,
  parent: NodeId | undefined,
  lines: Readonly<Record<string, NodeId>>,
): number | null {
  const refused = Predicate.isObject(err.details) ? err.details.id : undefined;
  if (typeof refused !== "string") return null;
  const numbers = Object.keys(lines).map(Number);
  const own = numbers.find((line) => lines[String(line)] === refused);
  if (own !== undefined) return own;
  return refused === parent && numbers.length > 0 ? Math.min(...numbers) : null;
}

/**
 * An item's fields as prop entries, each value read as its field's declared
 * type. A field that holds one value (`cardinalityOf`) and is given a second
 * by the same item is refused at the second value's line — the commit's
 * integrity check would refuse it too, but could not say where.
 */
const itemProps = Effect.fnUntraced(function* (
  item: OutlineItem,
  graph: NodeGraph,
  resolve: Resolve,
  today: LocalDate,
) {
  const entries: PropEntry[] = [];
  const held = new Set<NodeId>();
  for (const field of item.fields) {
    const fieldId = yield* syncDomain(() => resolveFieldIn(graph, field.name)).pipe(
      Effect.mapError(atLine(field.line)),
    );
    const props = graph.get(fieldId)?.props;
    const nodeOf = (id: NodeId) => graph.get(id);
    const type = fieldTypeOf(props, nodeOf);
    const single = cardinalityOf(props, nodeOf) === "one";
    const options = type === "ref" ? optionsOf(fieldId, graph) : [];
    for (const { line, raw } of field.values) {
      if (single && held.has(fieldId)) {
        return yield* domainError(
          "invalid_input",
          `outline line ${line}: ${field.name} holds one value, and this item gives it another`,
          { line, field: field.name },
        );
      }
      held.add(fieldId);
      const read = yield* syncDomain(() =>
        readValue(raw, type, { resolve, graph, options, today }),
      ).pipe(Effect.mapError(atLine(line)));
      if (!read.ok) {
        return yield* domainError(
          "invalid_input",
          `outline line ${line}: ${field.name} is a ${type} field; ${read.reason}`,
          { line, field: field.name },
        );
      }
      entries.push({ field: fieldId, value: read.value });
    }
  }
  return entries;
});

/**
 * The plan of `node.addTree` over `graph`, checked but not stored: every
 * item planned by `node.add`'s own planner (`planNodeAdd`: tag and field
 * resolution, cardinality, placement), each step `put`ting
 * its upserts into `graph` so the next one sees them. Beyond what `node.add`
 * does, refs in text and values are resolved and rewritten first
 * (`linkText`), a dangling one is refused, and a one-valued field given two
 * values by one item is refused at its line. Any failure names its line,
 * a refusal of the commit's system-write rule included (`refusedLine`).
 */
export const planNodeAddTreeEffect = Effect.fn("node.addTree.plan")(function* (
  input: PlacedTreeInput,
  graph: NodeGraph,
): Effect.fn.Return<
  z.infer<typeof nodeAddTreeDef.outputSchema> & { upserts: KbNode[] },
  DomainError
> {
  const format = outlineFormat(input.format ?? "tana");
  if (format.read === undefined) {
    return yield* domainError(
      "invalid_input",
      `${format.label} (${format.id}) has no reader: it is written for other programs, never read back`,
    );
  }
  const parsed = format.read(input.outline);
  if (!parsed.ok) {
    return yield* domainError("invalid_input", `outline line ${parsed.line}: ${parsed.reason}`, {
      line: parsed.line,
    });
  }
  if (parsed.items.length === 0) {
    return yield* domainError("invalid_input", "the outline has no items");
  }
  const at = yield* currentIso;
  const today = yield* currentLocalDate;
  const flat = flatten(parsed.items, input.position);
  const ids: NodeId[] = input.ids ?? [];
  if (input.ids !== undefined && ids.length !== flat.length) {
    return yield* domainError(
      "invalid_input",
      `expected ${flat.length} outline ids, got ${ids.length}`,
    );
  }
  while (ids.length < flat.length) ids.push(yield* freshId);
  const idAt = (index: number): NodeId =>
    present(ids[index], "node.addTree has one id per flattened item");
  const planned: PlannedItem[] = flat.map(({ item, parentIndex, position }, index) => ({
    item,
    id: idAt(index),
    parent: parentIndex === null ? (input.parent ?? undefined) : idAt(parentIndex),
    position,
  }));

  const resolve = refResolver(graph, planned);
  const written = new Set<NodeId>();

  for (const { item, id, parent, position } of planned) {
    const props = yield* itemProps(item, graph, resolve, today);
    const { written: wrote } = yield* syncDomain(() =>
      planNodeAdd(
        graph,
        {
          text: linkText(item.text, resolve),
          props,
          tags: item.tags,
          ...(parent === undefined ? {} : { parent }),
          ...(position === undefined ? {} : { position }),
          ...(input.force === true ? { force: true } : {}),
        },
        id,
        at,
      ),
    ).pipe(Effect.mapError(atLine(item.line)));
    for (const w of wrote) written.add(w);
  }

  return {
    ids,
    lines: Object.fromEntries(planned.map(({ item, id }) => [String(item.line), id])),
    upserts: [...written].map((id) => present(graph.get(id), "a written node is in the graph")),
  };
});

/**
 * `node.addTree`: a whole outline as one transaction — its plan at its
 * place (`placeOf`, with what the capture target makes there) over the
 * session's stored graph, indexed once, committed once on the state it was
 * planned from (`persistPlannedEffect`): one integrity check, one
 * transaction-log entry, one undo step. Any failure, on any line, writes
 * nothing.
 */
export const nodeAddTreeEffect = Effect.fn("node.addTree")(function* (
  input: NodeAddTreeInput,
): Effect.fn.Return<
  z.infer<typeof nodeAddTreeDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | CaptureTarget
> {
  const ctx = yield* KbCtx;
  // The last plan made, so a refused commit can name the line it refused.
  let last: { readonly parent: NodeId | null; readonly lines: Record<string, NodeId> } | null =
    null;
  const plan = Effect.fn("node.addTree.placed")(function* (nodes: readonly KbNode[]) {
    const place = yield* placeOf(input.parent, nodes);
    const { graph, upserts } = placedGraph(nodes, place.upserts);
    const tree = yield* planNodeAddTreeEffect({ ...input, parent: place.parent }, graph);
    last = { parent: place.parent, lines: tree.lines };
    return { ...tree, upserts: upserts(tree.upserts.map(({ id }) => id)), deletes: [] };
  });
  const planned = yield* persistPlannedEffect(ctx, plan, forcedBy(input)).pipe(
    Effect.mapError((err) => {
      const line = last === null ? null : refusedLine(err, last.parent ?? undefined, last.lines);
      return line === null ? err : atLine(line)(err);
    }),
  );
  const { ids, lines } = present(planned, "an outline add always writes");
  return { ids, lines };
});
