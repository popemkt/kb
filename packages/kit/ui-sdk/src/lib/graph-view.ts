import { Option, Schema } from "effect";
import type { SchemaIndex } from "./schema";
import type { WireNode } from "@kb/contracts";
import { chipTagsOf, compareRootOrder, hasQueryDef, isScaffolding, nodeName } from "@kb/model";
import { nameIn } from "./contextual-ref";
import { tagColorOf, tagPalette, type TagPalette } from "./tag-color";
import { resolveVisibleProps, isFieldHidden, type ResolvePropsOptions } from "./field-visibility";
import { hasText } from "./text";
import { placeOfInstance } from "./instance-key";
import {
  EXPANDED_STORAGE_KEY,
  EXPANSION_STORAGE_KEY,
  WORKSPACE_ROOT_ID,
  type OutlineNode,
  type ResolvedProp,
  type TagBadge,
} from "./types.ts";

/** DISPLAY: the `#tag` chips a row shows (`chipTagsOf`), each with its name and colour. */
function resolveTags(wire: WireNode, byId: Map<string, WireNode>, palette: TagPalette): TagBadge[] {
  return chipTagsOf(wire, (id) => byId.get(id)).map((typeId) => ({
    id: typeId,
    name: nodeName(typeId, (id) => byId.get(id)) || typeId,
    color: tagColorOf(typeId, palette),
  }));
}

/** Nodes that appear in some parent's children list. */
function childIdSet(nodes: WireNode[]): Set<string> {
  const kids = new Set<string>();
  for (const n of nodes) {
    for (const c of n.children) kids.add(c);
  }
  return kids;
}

/**
 * Top-level outline roots: the nodes nested under no other node, but the
 * store's scaffolding (`isScaffolding`), so a top-level tag is a root as any
 * node is (DESIGN-UI.md → Outline editor, "The home outline").
 */
export function forestRootIds(nodes: WireNode[]): string[] {
  const kids = childIdSet(nodes);
  return nodes
    .filter((n) => !kids.has(n.id) && !isScaffolding(n))
    .toSorted(compareRootOrder)
    .map((n) => n.id);
}

function wireHasVisibleFields(wire: WireNode, byId: Map<string, WireNode>): boolean {
  for (const [fieldId, values] of Object.entries(wire.props)) {
    if (values.length === 0) continue;
    if (isFieldHidden(fieldId, byId)) continue;
    return true;
  }
  return false;
}

function nodeDefaultsCollapsed(wire: WireNode, byId: Map<string, WireNode>): boolean {
  if (hasQueryDef(wire.props)) return true;
  if (wire.children.length > 0) return true;
  if (wireHasVisibleFields(wire, byId)) return true;
  return false;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function sameTags(a: readonly TagBadge[], b: readonly TagBadge[]): boolean {
  return (
    a.length === b.length &&
    a.every((tag, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        tag.id === other.id &&
        tag.name === other.name &&
        tag.color === other.color
      );
    })
  );
}

function sameProps(a: OutlineNode["props"], b: OutlineNode["props"]): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const left = a[key] ?? [];
    const right = b[key];
    return (
      right !== undefined &&
      left.length === right.length &&
      left.every((value, i) => {
        const other = right[i];
        return (
          value === other || (other !== undefined && value.t === other.t && value.v === other.v)
        );
      })
    );
  });
}

/** Whether two projections of a node are the same value, field by field. */
function sameOutlineNode(a: OutlineNode, b: OutlineNode): boolean {
  return a.collapsed === b.collapsed && sameMeaning(a, b);
}

/**
 * Whether two projections of a node say the same about it, whatever their
 * expansion: everything but `collapsed`, which is the outline's view state
 * and nothing a schema reader asks (`lib/schema.ts`).
 */
export function sameMeaning(a: OutlineNode, b: OutlineNode): boolean {
  return (
    a === b ||
    (a.text === b.text &&
      a.parentId === b.parentId &&
      a.createdAt === b.createdAt &&
      a.updatedAt === b.updatedAt &&
      sameIds(a.children, b.children) &&
      sameTags(a.tags, b.tags) &&
      sameProps(a.props, b.props))
  );
}

/** Every map `wireToOutlineMap` built of part of a graph: a scope's projection. */
const partialProjections = new WeakSet<ReadonlyMap<string, OutlineNode>>();

/**
 * Whether `map` was projected from part of its graph (a node of `graph` is
 * not in `nodes`), so it is no schema: a definition outside it would be
 * missing (`lib/schema.ts`).
 */
export function isPartialProjection(map: ReadonlyMap<string, OutlineNode>): boolean {
  return partialProjections.has(map);
}

/**
 * The outline view model for `nodes`. Each node's tag chips — names and
 * colours — and its default collapse (does it show fields?; whether a row is
 * open is the reader's, per place: `isRowOpen`) are resolved against
 * `graph`: the whole graph, which is `nodes` itself unless `nodes` is a
 * projection of it (an ontology scope). The outline's structure comes from
 * `nodes`; what the schema means, and the tag palette (`tagPalette`, one
 * palette for the whole workspace), never depend on which content is shown
 * (`lib/schema.ts`).
 *
 * The projection is persistent: a node that projects to the value it had in
 * one of the `previous` maps keeps that object (the first such, in order), so
 * a node's identity changes exactly when what it shows does. That is what
 * lets a reader depend on the nodes it read instead of on the whole map
 * (`stores/graph-read.ts`).
 */
export function wireToOutlineMap(
  nodes: WireNode[],
  graph: readonly WireNode[] = nodes,
  previous: readonly ReadonlyMap<string, OutlineNode>[] = [],
): Map<string, OutlineNode> {
  const byId = new Map(graph.map((n) => [n.id, n]));
  const palette = tagPalette(graph);
  const parentOf = new Map<string, string>();
  for (const n of nodes) {
    for (const c of n.children) parentOf.set(c, n.id);
  }

  const map = new Map<string, OutlineNode>();
  const keep = (next: OutlineNode): void => {
    let kept = next;
    for (const earlier of previous) {
      const before = earlier.get(next.id);
      if (before !== undefined && sameOutlineNode(before, next)) {
        kept = before;
        break;
      }
    }
    map.set(next.id, kept);
  };
  const roots = forestRootIds(nodes);
  const rootSet = new Set(roots);

  keep({
    id: WORKSPACE_ROOT_ID,
    text: "kb",
    parentId: null,
    children: roots,
    collapsed: false,
    props: {},
    createdAt: "",
    updatedAt: "",
    tags: [],
  });

  for (const wire of nodes) {
    // A forest root is in no children list: the workspace is its parent.
    const parentId = parentOf.get(wire.id) ?? (rootSet.has(wire.id) ? WORKSPACE_ROOT_ID : null);
    const tags = resolveTags(wire, byId, palette);
    keep({
      id: wire.id,
      text: wire.text,
      parentId,
      children: [...wire.children],
      collapsed: nodeDefaultsCollapsed(wire, byId),
      props: wire.props,
      createdAt: wire.createdAt,
      updatedAt: wire.updatedAt,
      tags,
    });
  }

  if (nodes !== graph && graph.some((n) => !map.has(n.id))) partialProjections.add(map);
  return map;
}

/**
 * Which rows the reader opened or closed, each under the place it stands at
 * (`placeOfInstance`): a choice over the row's default collapse (does it show
 * children or fields?). A row with no choice shows its default.
 */
export type Expansion = ReadonlyMap<string, boolean>;

/**
 * Whether the row of `node` drawn at `instanceKey` is open: the reader's
 * choice for its place, else its node's default (`collapsed`).
 */
export function isRowOpen(node: OutlineNode, instanceKey: string, expansion: Expansion): boolean {
  return expansion.get(placeOfInstance(instanceKey)) ?? !node.collapsed;
}

export function resolveProps(
  node: OutlineNode,
  schema: SchemaIndex,
  opts?: ResolvePropsOptions,
): ResolvedProp[] {
  return resolveVisibleProps(node, schema, opts);
}

/** Resolve a ref prop to a label: its target's name when present, otherwise null. */
function resolveRefLabel(refId: string, schema: SchemaIndex): string | null {
  if (!schema.has(refId)) return null;
  // A ref value is labelled by its target's name (DESIGN.md → Display text).
  return nameIn(schema, refId) || refId;
}

export function formatPropValue(
  value: OutlineNode["props"][string][number],
  schema: SchemaIndex,
): string {
  switch (value.t) {
    case "ref": {
      const resolved = resolveRefLabel(value.v, schema);
      return resolved ?? value.v;
    }
    case "bool":
      return value.v ? "true" : "false";
    case "num":
      return String(value.v);
    case "date":
    case "str":
      return value.v;
    default:
      return JSON.stringify(value);
  }
}
// off-graph: device-local — which rows are open and which nodes show their debug fields are this screen's view of the graph, not facts about it
/**
 * Persisted set of node ids in localStorage — the one storage shape for
 * "which nodes has the user flagged for this?" (expanded rows, per-node debug
 * fields). Callers own the key; this owns the encoding and the failure modes.
 */
export function loadIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!hasText(raw)) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function saveIdSet(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // ignore quota / private mode
  }
}

/** The stored form of an expansion: the places opened and the places closed. */
const StoredExpansion = Schema.Struct({
  open: Schema.Array(Schema.String),
  closed: Schema.Array(Schema.String),
});

const decodeStoredExpansion = Schema.decodeUnknownOption(Schema.fromJsonString(StoredExpansion));

/**
 * Where a stored choice stands: a place as it is stored, or, for a bare node
 * id an older build kept a node's one choice under, that node's place in the
 * outline's tree (`placeOfId`). A place always has a separator; an id never.
 */
function storedPlace(key: string, placeOfId: (id: string) => string): string {
  return key.includes("/") ? key : placeOfId(key);
}

/** The `{ open, closed }` stored under `kb-expansion`, or null when it is absent or unreadable. */
function readStoredExpansion(placeOfId: (id: string) => string): Map<string, boolean> | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(EXPANSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!hasText(raw)) return null;
  const stored = Option.getOrNull(decodeStoredExpansion(raw));
  if (stored === null) return null;
  const expansion = new Map<string, boolean>();
  for (const key of stored.open) expansion.set(storedPlace(key, placeOfId), true);
  for (const key of stored.closed) expansion.set(storedPlace(key, placeOfId), false);
  return expansion;
}

/**
 * The expansion kept in storage, shared by every tab: `kb-expansion`, or,
 * while no build has written that, the legacy `kb-expanded` open ids. A node
 * id stored by an older build is read as the node's tree place (`placeOfId`).
 * A read writes nothing.
 */
export function loadExpansion(placeOfId: (id: string) => string): Expansion {
  return (
    readStoredExpansion(placeOfId) ??
    new Map([...loadIdSet(EXPANDED_STORAGE_KEY)].map((id) => [placeOfId(id), true] as const))
  );
}

/**
 * A tab's changes to its expansion, by place: the choice it now holds, or
 * null where it holds none.
 */
export type ExpansionChanges = ReadonlyMap<string, boolean | null>;

/**
 * Apply `changes` onto the expansion storage holds now, never a snapshot of
 * this tab's: another tab's choices for other rows survive as they are. One
 * write, so the stored form is never half-written.
 */
export function saveExpansionChanges(
  changes: ExpansionChanges,
  placeOfId: (id: string) => string,
): void {
  const stored = new Map(loadExpansion(placeOfId));
  for (const [place, open] of changes) {
    if (open === null) stored.delete(place);
    else stored.set(place, open);
  }
  const open: string[] = [];
  const closed: string[] = [];
  for (const [id, isOpen] of stored) (isOpen ? open : closed).push(id);
  try {
    localStorage.setItem(EXPANSION_STORAGE_KEY, JSON.stringify({ open, closed }));
  } catch {
    // ignore quota / private mode
  }
}
