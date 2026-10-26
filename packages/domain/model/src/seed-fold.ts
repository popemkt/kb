/**
 * The bundled fold (DESIGN.md → Extension families → the seed is the bundled
 * fold): every declaration's seed nodes, the node each declaration derives
 * under `sys.extensions`, the option node each declared view derives under
 * `sys.views`, the option node each declared option (a backdrop, a design
 * system) derives
 * under the field of its kind, and the default view type its one provider
 * declares, folded
 * into the seed a store is opened with, together with which declaration
 * each folded node came from.
 */
import {
  chosenProps,
  declaredOptionId,
  type DeclaredOptions,
  type DeclaredOptionSet,
  type SeedOption,
} from "./declared-option.ts";
import {
  SYSTEM_IDS,
  extensionNodeId,
  isSysPrefixed,
  type KbNode,
  type NodeId,
  nowIso,
} from "./model.ts";
import type { SeedRetirement } from "./seed-retirement.ts";
import { VIEW_FAMILY_VALUES, viewOptionId, type ViewFamily } from "./view-node.ts";

/**
 * A view as the seed names it: its id, the label its option node carries,
 * and the family it is one of. A view's key is one, so the option is derived
 * from the key and never declared a second time.
 */
export interface SeedView {
  readonly id: string;
  readonly label: string;
  readonly family?: ViewFamily | undefined;
}

/**
 * What one declaration gives the seed (DESIGN.md → Extension families → the
 * seed is the bundled fold): its own system nodes under frozen ids, the
 * views whose option nodes the fold derives, and, from at most one source,
 * which of those views a node that names no view opens in.
 */
export interface SeedSource {
  readonly name: string;
  /** What its own node (`extensionNodeId(name)`) is called. */
  readonly label: string;
  readonly seed?: (at: string) => readonly KbNode[];
  readonly views?: readonly { readonly key: SeedView }[];
  /**
   * Its own seed nodes it files under another source's list node, by that
   * list's id: the fold appends each id to the list's children, after those
   * it already has, in source order. A pin among the Pinned, a view node
   * among the Views. The nodes stay this source's.
   */
  readonly files?: Readonly<Record<NodeId, readonly NodeId[]>>;
  /** The declared options it contributes, by kind; the fold derives each one's option node. */
  readonly declaredOptions?: readonly DeclaredOptionSet[];
  /**
   * The view type a node that names no view opens in: one of this source's
   * own `views`, by its key, so it selects from the list and names nothing
   * else. The fold writes it as `sys.views`' `sys.f.view.default`.
   */
  readonly defaultView?: SeedView;
  /**
   * The seeded ids it renamed or removed since a store could have been
   * seeded with them, each with what replaced it, if anything: its rows of
   * the retirement table (`SeedRetirement`), which opening applies before
   * it seeds.
   */
  readonly retires?: readonly SeedRetirement[];
}

/**
 * The default view type the sources provide, as `sys.views`' prop: the one
 * source's `defaultView`, which must be one of its own views. Two sources
 * that each provide one, or one that names a view it does not provide, is a
 * bundling defect, so it throws. With none, `sys.views` names no default and
 * a node that names no view opens as broken (DESIGN.md → View nodes).
 */
function defaultViewProps(sources: readonly SeedSource[]): KbNode["props"] {
  const providers = sources.filter((source) => source.defaultView !== undefined);
  const [provider, second] = providers;
  if (second !== undefined) {
    throw new Error(
      `the default view type is provided twice (${providers.map((p) => p.name).join(", ")})`,
    );
  }
  const view = provider?.defaultView;
  if (provider === undefined || view === undefined) return {};
  if (!(provider.views ?? []).some(({ key }) => key.id === view.id)) {
    throw new Error(`${provider.name} names ${view.id} its default view but provides no such view`);
  }
  return { [SYSTEM_IDS.viewDefaultField]: [{ t: "ref", v: viewOptionId(view.id) }] };
}

/** The option node that names `view` under `sys.views`, carrying its family. */
function viewOptionNode(view: SeedView, at: string): KbNode {
  return {
    id: viewOptionId(view.id),
    text: view.label,
    props:
      view.family === undefined
        ? {}
        : { [SYSTEM_IDS.viewFamilyField]: [{ t: "ref", v: VIEW_FAMILY_VALUES[view.family].id }] },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Every kind `sources` declare options of, once each, in the order first
 * declared. A kind is its field: two kinds on one field with two prefixes
 * is a bundling defect, so it throws.
 */
function declaredKinds(sources: readonly SeedSource[]): DeclaredOptions[] {
  const kinds = new Map<NodeId, DeclaredOptions>();
  for (const { kind } of sources.flatMap((source) => source.declaredOptions ?? [])) {
    const known = kinds.get(kind.field);
    if (known === undefined) kinds.set(kind.field, kind);
    else if (known.prefix !== kind.prefix) {
      throw new Error(
        `${kind.field}'s options are declared under ${known.prefix} and ${kind.prefix}`,
      );
    }
  }
  return [...kinds.values()];
}

/** The option nodes `source` declares among `kind`'s, in its order. */
function declaredOf(source: SeedSource, kind: DeclaredOptions, at: string): KbNode[] {
  return (source.declaredOptions ?? [])
    .filter((set) => set.kind.field === kind.field)
    .flatMap((set) => set.options.map((option) => declaredOptionNode(kind, option, at)));
}

/** The option node that names the declared `option` among `kind`'s, a child of its field. */
function declaredOptionNode(kind: DeclaredOptions, option: SeedOption, at: string): KbNode {
  return {
    id: declaredOptionId(kind, option.id),
    text: option.label,
    props: { ...option.props, ...chosenProps(option) },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * A source's own node, `sys.extension.<name>`, as the fold derives it: named
 * by its label and holding nothing, so an optional family's switch reads as
 * its declared default until someone switches it. Being one of
 * `sys.extensions`' children is what it is, as a view's option is one of
 * `sys.views`'.
 */
function extensionNode(source: SeedSource, at: string): KbNode {
  return {
    id: extensionNodeId(source.name),
    text: source.label,
    props: {},
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * `nodes` with each source's `files` appended to the children of the list
 * node it names. A list no source declares, or a filed id that is not one
 * of the filing source's own seed nodes, is a bundling defect, so it
 * throws.
 */
function withFiled(
  nodes: readonly KbNode[],
  parts: readonly {
    readonly name: string;
    readonly seed: readonly KbNode[];
    readonly files: SeedSource["files"];
  }[],
): KbNode[] {
  const filed = new Map<NodeId, NodeId[]>();
  for (const { name, seed, files } of parts) {
    const own = new Set(seed.map((node) => node.id));
    for (const [list, ids] of Object.entries(files ?? {})) {
      const stray = ids.find((id) => !own.has(id));
      if (stray !== undefined) throw new Error(`${name} files ${stray}, which it does not seed`);
      filed.set(list, [...(filed.get(list) ?? []), ...ids]);
    }
  }
  for (const list of filed.keys()) {
    if (!nodes.some((node) => node.id === list)) throw new Error(`no seed source declares ${list}`);
  }
  return nodes.map((node) => {
    const ids = filed.get(node.id);
    return ids === undefined ? node : { ...node, children: [...node.children, ...ids] };
  });
}

/**
 * `nodes` with `derived` filed under the list node `rootId`, after the
 * children it already has, and placed right after it.
 */
function fileUnder(nodes: readonly KbNode[], rootId: string, derived: readonly KbNode[]): KbNode[] {
  const rootAt = nodes.findIndex((node) => node.id === rootId);
  const root = nodes[rootAt];
  if (root === undefined) throw new Error(`no seed source declares ${rootId}`);
  return [
    ...nodes.slice(0, rootAt),
    { ...root, children: [...root.children, ...derived.map((node) => node.id)] },
    ...derived,
    ...nodes.slice(rootAt + 1),
  ];
}

/**
 * One fold, read two ways: the seed a store is opened with, and its
 * provenance, the name of the source each of those nodes came from. A
 * source owns its seed nodes, the option node of each view and each
 * declared option it declares, and its own node; the list nodes the derived ones are filed under stay their
 * declarer's. The owner is known only here, where the fold already proves
 * each id has exactly one, so nothing else keeps a second copy of it.
 */
export interface FoldedSeed {
  readonly nodes: KbNode[];
  readonly owners: ReadonlyMap<NodeId, string>;
  /** Every source's retirement rows, in source order (`retiredRows`). */
  readonly retired: readonly SeedRetirement[];
}

/**
 * Every source's retirement rows, in source order. A retired id outside
 * the reserved `sys.` prefix (a store's other ids are its owner's, so a
 * row could delete a node a person made under the same id), an id retired
 * twice, a retired id the fold still seeds (opening would retire what it
 * then seeds again), or a replacement the fold does not seed is a bundling
 * defect, so it throws.
 */
function retiredRows(
  sources: readonly SeedSource[],
  seeded: ReadonlySet<NodeId>,
): SeedRetirement[] {
  const rows = sources.flatMap((source) =>
    (source.retires ?? []).map((row) => ({ row, by: source.name })),
  );
  const retired = new Set<NodeId>();
  for (const { row, by } of rows) {
    if (!isSysPrefixed(row.from)) {
      throw new Error(`${by} retires ${row.from}, which is not a reserved sys. id`);
    }
    if (retired.has(row.from)) throw new Error(`${row.from} is retired twice`);
    retired.add(row.from);
    if (seeded.has(row.from))
      throw new Error(`${by} retires ${row.from}, which the seed still holds`);
    if (row.to !== undefined && !seeded.has(row.to)) {
      throw new Error(`${by} retires ${row.from} for ${row.to}, which the seed does not hold`);
    }
  }
  return rows.map(({ row }) => row);
}

/**
 * The seed a store is opened with: every source's nodes, in source order;
 * every source's own node, a child of `sys.extensions` in the same order;
 * and every source's views as option nodes, children of `sys.views` in the
 * same order; every source's declared options as option nodes, children of
 * the field of their kind (`declaredKinds`: `sys.f.backdrop`,
 * `sys.f.design-system`, or a family's own) in the same order; with
 * `sys.views` naming the default view type its one provider declares
 * (`defaultViewProps`). Each derived node is placed right after its list. Each node's owner comes with it ({@link FoldedSeed}).
 * Pure data: it opens nothing, and it throws on an id two sources declare,
 * because that is a bundling defect no store can repair.
 */
export function foldSeed(sources: readonly SeedSource[], at: string = nowIso()): FoldedSeed {
  const kinds = declaredKinds(sources);
  const parts = sources.map((source) => ({
    name: source.name,
    seed: source.seed?.(at) ?? [],
    files: source.files,
    options: (source.views ?? []).map((view) => viewOptionNode(view.key, at)),
    declared: kinds.map((kind) => declaredOf(source, kind, at)),
    own: extensionNode(source, at),
  }));
  const withViews = fileUnder(
    withFiled(
      parts.flatMap((part) => part.seed),
      parts,
    ),
    SYSTEM_IDS.viewsRoot,
    parts.flatMap((part) => part.options),
  );
  const withDeclared = kinds.reduce(
    (nodes, kind, row) =>
      fileUnder(
        nodes,
        kind.field,
        parts.flatMap((part) => part.declared[row] ?? []),
      ),
    withViews,
  );
  const folded = fileUnder(
    withDeclared,
    SYSTEM_IDS.extensionsRoot,
    parts.map((part) => part.own),
  );
  const seen = new Set<string>();
  for (const node of folded) {
    if (seen.has(node.id)) throw new Error(`seed id ${node.id} is declared twice`);
    seen.add(node.id);
  }
  // Read once every id is known to have one owner, so a doubled source is
  // refused for its ids first.
  const defaults = defaultViewProps(sources);
  const retired = retiredRows(sources, seen);
  return {
    nodes: folded.map((node) =>
      node.id === SYSTEM_IDS.viewsRoot ? { ...node, props: { ...node.props, ...defaults } } : node,
    ),
    owners: new Map(
      parts.flatMap((part) =>
        [...part.seed, ...part.options, ...part.declared.flat(), part.own].map(
          (node) => [node.id, part.name] as const,
        ),
      ),
    ),
    retired,
  };
}
