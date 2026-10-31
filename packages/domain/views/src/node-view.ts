/**
 * What `/node/<id>[/<view>]` shows: a node in its default view, or through
 * one view. One function, so the UI's own links, a pane, a layout's panes and
 * `ui.navigate` open a node the same way. DESIGN.md → Kinds, roles and
 * options → Layout views states the rule.
 */
import { Result } from "effect";
import {
  SYSTEM_IDS,
  canonicalJson,
  defaultViewIdOf,
  defaultViewTypeOf,
  hostViewIds,
  isViewNode,
  tagDefaultViewsOf,
  viewIdOfOption,
  viewOptionId,
  viewOptionOf,
  type NodeId,
  type NodeProps,
} from "@kb/model";
import type { CatalogItem, ViewCatalogEntry, ViewCatalogOf } from "./catalog.ts";
import { HomeView, LayoutView, NodeReadView, NodeView, type NodeParams } from "./layout.ts";
import { paramsFromProps, type ConfigReport, type ViewKey, type ViewPage } from "./view-key.ts";

/** What the resolver reads of a node: its props, and its text when it names a view. */
interface Carrier {
  readonly props: NodeProps;
  readonly text?: string;
}

/**
 * The view a node opens in: its key, the input its params decode from, and
 * the subject the slot shows it for (the view node, or the node).
 */
export interface HeldViewTarget {
  readonly key: ViewKey<unknown>;
  readonly input: unknown;
  readonly subject: NodeId;
  /** The view node it shows, when it shows one (not a view type). */
  readonly viewNode?: NodeId;
}

/** A view as a host names one it cannot draw: its id and its label. */
export type NamedView = Pick<ViewCatalogEntry, "id" | "label">;

/**
 * A view the host holds no key for: one its catalog lists without a key (the
 * page, for a view no loaded plugin draws), or one of a family the host has
 * switched off, which no catalog lists. Named ({@link viewNamed}), so a host
 * can say which view it cannot show here.
 */
export interface UnheldViewTarget {
  readonly key: null;
  readonly listed: NamedView;
  readonly subject: NodeId;
  readonly viewNode?: NodeId;
}

/**
 * The view the data names for a node is broken: a host's view node that is
 * gone or names no view kb knows, or a store default view type that is
 * missing or names none. The node is there and opens, as a view that cannot
 * be shown here, saying why (`broken`, the warning the resolver reported).
 */
export interface BrokenViewTarget {
  readonly key: null;
  readonly listed: null;
  readonly broken: string;
  readonly subject: NodeId;
}

export type NodeViewTarget = HeldViewTarget | UnheldViewTarget | BrokenViewTarget;

type Catalog = Pick<ViewCatalogOf<CatalogItem>, "keyOf" | "listedOf">;

/** What resolving reads: the host's catalog, the graph, and where a warning goes. */
interface Resolving {
  readonly catalog: Catalog;
  readonly lookup: (id: NodeId) => Carrier | undefined;
  readonly report: ConfigReport;
}

/** Why the home is refused as a view a node opens in: it would draw itself. */
const HOME_REFUSED = `${HomeView.id} is the page's home, no view a node opens in`;

type Opened = Result.Result<HeldViewTarget | UnheldViewTarget, string>;

/**
 * The page a view of `key` is shown on, shown for `host` through view node
 * `viewNode`: the page its key names (`ViewKey.page`), else the view itself,
 * its params read from `props` for `host`.
 */
function pageOf(
  key: ViewKey<unknown>,
  props: NodeProps,
  host: NodeId | null,
  viewNode: NodeId | null,
  report: ConfigReport,
): ViewPage {
  return key.page?.({ host, viewNode }) ?? { key, input: key.config.read(props, host, report) };
}

/** Where a view target is shown: the slot's subject, and the view node it shows, if any. */
interface Shown {
  readonly subject: NodeId;
  readonly viewNode?: NodeId;
}

/**
 * `page`, shown for `host`, when this host holds its key. A key's page may be
 * another family's view (a frame view's is the outline at the frame), which
 * the host may not hold: then `host` is read in its place ({@link readInPlace}).
 */
// GAP [[01M5MWXPDDZGG2PFEGMG95HMBY]] a frame view's page is the outline at the frame, so without it the frame is read
function shownPage(page: ViewPage, host: NodeId | null, shown: Shown, r: Resolving): Opened {
  const held = r.catalog.keyOf(page.key.id) !== null;
  const read = held ? null : readInPlace(host, shown, labelOf(page.key.id, r) ?? page.key.label, r);
  return read ?? Result.succeed({ ...page, ...shown });
}

/** The label view `view` is named by on this host ({@link viewNamed}), if any. */
function labelOf(view: string, r: Resolving): string | undefined {
  return viewNamed(view, r.catalog, r.lookup)?.label;
}

/**
 * `host` read ({@link NodeReadView}, core's) in place of the view labelled
 * `insteadOf` (null: the store names no default view type), so a node always
 * has a view to open in. Null where the host holds no key for the read view
 * either.
 */
function readInPlace(
  host: NodeId | null,
  shown: Shown,
  insteadOf: string | null,
  r: Resolving,
): Opened | null {
  if (r.catalog.keyOf(NodeReadView.id) === null) return null;
  const input = {
    ...(host === null ? {} : { root: host }),
    ...(insteadOf === null ? {} : { insteadOf }),
  };
  return Result.succeed({ key: NodeReadView, input, ...shown });
}

/**
 * What `params` opens, reading nodes through `lookup` and naming views
 * through `catalog`, the host's view catalog:
 *
 * - `view` names a view type (its option): that view, with the settings a
 *   view node holding none reads as, shown for the node;
 * - `view` names a view node: that view node, shown for the node;
 * - no `view`, and the node is a view node: that view node, shown for no node;
 * - no `view`: the node's default view (the first view node it names), or,
 *   when it names none, the first of its tags' default view types this host
 *   holds a key for (`tagDefaultViewsOf`), else the store's default view
 *   type, which `sys.views` names (`defaultViewTypeOf`), each opened as if
 *   `view` named it.
 *
 * A tag's default this host holds no key for (its family switched off, or
 * not bundled) is passed over, so the node opens as if the tag named none;
 * one that names no view type is reported and passed over. A node always
 * has a view to open in: where the store's default view type
 * is one this host holds no key for (its family is switched off, or not
 * bundled), or the store names none, the node is read
 * ({@link NodeReadView}, core's) in its place. So is a held view whose page
 * is another view the host does not hold (a frame view's page is the
 * outline at the frame).
 *
 * A view the host holds no key for resolves to its name (`key: null`,
 * {@link viewNamed}), not to a failure: the node is there, and its view is
 * one this host cannot draw, because no plugin here draws it or its family
 * is switched off. A view the data names that is broken is reported and
 * resolves as one ({@link BrokenViewTarget}), never as a failure, so a broken
 * definition never makes a node unopenable. What fails is the location
 * only: a node that is not there, or a `view` that names no view.
 */
export function resolveNodeView(
  params: NodeParams,
  catalog: Catalog,
  lookup: (id: NodeId) => Carrier | undefined,
  report: ConfigReport,
): Result.Result<NodeViewTarget, string> {
  const node = lookup(params.node);
  if (node === undefined) return Result.fail(`no node ${params.node}`);
  const r: Resolving = { catalog, lookup, report };
  if (params.view !== undefined) return throughNamed(params.view, params.node, r);
  const opened = isViewNode(node)
    ? throughViewNode(params.node, null, r)
    : throughDefault(node, params.node, r);
  if (Result.isSuccess(opened)) return opened;
  report(opened.failure);
  return Result.succeed({ key: null, listed: null, broken: opened.failure, subject: params.node });
}

/** `node` through the view `view` names: a view type by its option, else a view node. */
function throughNamed(view: string, node: NodeId, r: Resolving): Opened {
  const type = viewIdOfOption(view);
  return type === null ? throughViewNode(view, node, r) : throughType(type, node, node, r);
}

/**
 * `node` (carried by `carrier`) in its default view: the first view node it
 * names, else its first tag's default view type this host holds
 * ({@link heldTagDefault}), else the store's default view type.
 */
function throughDefault(carrier: Carrier, node: NodeId, r: Resolving): Opened {
  const viewId = defaultViewIdOf(carrier);
  if (viewId !== null) return throughViewNode(viewId, node, r);
  const tagged = heldTagDefault(carrier, r);
  if (tagged !== null)
    return shownPage(pageOf(tagged, {}, node, null, r.report), node, { subject: node }, r);
  return throughDefaultType(node, node, r);
}

/**
 * The key of the first of `carrier`'s tags' default view types this host
 * holds, or null. One that names no view type, or names the home, is
 * reported and passed over; one this host holds no key for is passed over.
 */
function heldTagDefault(carrier: Carrier, r: Resolving): ViewKey<unknown> | null {
  for (const { tag, option } of tagDefaultViewsOf(carrier, r.lookup)) {
    const type = viewIdOfOption(option);
    if (type === null || type === HomeView.id) {
      r.report(
        `${tag}'s default view type ${option} is no view a node opens in (${SYSTEM_IDS.viewDefaultField})`,
      );
      continue;
    }
    const key = r.catalog.keyOf(type);
    if (key !== null) return key;
  }
  return null;
}

/**
 * The store's default view type, which `sys.views` names
 * (`defaultViewTypeOf`), shown for `host` (null: for no node) in a slot shown
 * for `subject`. Where the store names none, or names one this host holds no
 * key for (its family switched off, or not bundled), `host` is read in its
 * place ({@link readInPlace}), so no family is one a node needs to open in.
 * A default that names no view type is broken data, and opens as broken.
 */
function throughDefaultType(host: NodeId | null, subject: NodeId, r: Resolving): Opened {
  const option = defaultViewTypeOf(r.lookup(SYSTEM_IDS.viewsRoot));
  const type = option === null ? null : viewIdOfOption(option);
  if (option !== null && type === null)
    return Result.fail(
      `${SYSTEM_IDS.viewsRoot}'s default view type ${option} is no view type (${SYSTEM_IDS.viewDefaultField})`,
    );
  if (type === null) {
    // Missing: the node is read in its place, and the store's gap is logged.
    const missing = `${SYSTEM_IDS.viewsRoot} names no default view type (${SYSTEM_IDS.viewDefaultField})`;
    const read = readInPlace(host, { subject }, null, r);
    if (read === null) return Result.fail(missing);
    r.report(missing);
    return read;
  }
  // The home is the page's own zoom, shown in the default view type: it is no view one opens in.
  if (type === HomeView.id) {
    return (
      readInPlace(host, { subject }, labelOf(type, r) ?? HomeView.label, r) ??
      Result.fail(HOME_REFUSED)
    );
  }
  const key = r.catalog.keyOf(type);
  if (key !== null) return shownPage(pageOf(key, {}, host, null, r.report), host, { subject }, r);
  // Only a view type kb knows but this host does not load is read in place; a name no view has stays broken.
  const label = labelOf(type, r);
  if (label === undefined) return Result.fail(`no view ${type}`);
  return (
    readInPlace(host, { subject }, label, r) ?? unheld(r, type, { subject }, `no view ${type}`)
  );
}

/**
 * What a surface that shows "a scope's nodes as a node opens" shows: the
 * store's default view type, for no node, in a slot shown for `subject` (the
 * ontology a scope is of). The same reader a node that names no view opens
 * through, so the surface names no view itself.
 */
export function resolveDefaultViewType(
  subject: NodeId,
  catalog: Catalog,
  lookup: (id: NodeId) => Carrier | undefined,
  report: ConfigReport,
): Result.Result<HeldViewTarget | UnheldViewTarget, string> {
  return throughDefaultType(null, subject, { catalog, lookup, report });
}

/** View type `type`, read from an empty view node, shown for `host` in a slot shown for `subject`. */
function throughType(type: string, host: NodeId | null, subject: NodeId, r: Resolving): Opened {
  if (type === HomeView.id) return Result.fail(HOME_REFUSED);
  const key = r.catalog.keyOf(type);
  if (key === null) return unheld(r, type, { subject }, `no view ${type}`);
  return shownPage(pageOf(key, {}, host, null, r.report), host, { subject }, r);
}

/** View node `viewId`, shown for `host` (null: shown as itself). */
function throughViewNode(viewId: NodeId, host: NodeId | null, r: Resolving): Opened {
  const view = r.lookup(viewId);
  const option = viewOptionOf(view);
  const missing = `${viewId} is no view node`;
  if (view === undefined || option === null) return Result.fail(missing);
  if (option === HomeView.option) return Result.fail(HOME_REFUSED);
  const key = r.catalog.keyOf(option);
  if (key === null) return unheld(r, option, { subject: viewId, viewNode: viewId }, missing);
  const page = pageOf(key, view.props, host, viewId, r.report);
  return shownPage(page, host, { subject: viewId, viewNode: viewId }, r);
}

/**
 * The view `view` (its id or its option) names: as `catalog` lists it, else
 * as the graph holds its option node. A view of a family switched off is
 * listed by no catalog, but its option is seeded whatever loads (the seed is
 * the bundled fold), and the option's text is the view's label. Null for
 * neither, so a name that is no view stays one.
 */
export function viewNamed(
  view: string,
  catalog: Pick<Catalog, "listedOf">,
  lookup: (id: NodeId) => Carrier | undefined,
): NamedView | null {
  const listed = catalog.listedOf(view);
  if (listed !== null) return listed;
  const id = viewIdOfOption(view) ?? view;
  const label = lookup(viewOptionId(id))?.text;
  return label === undefined ? null : { id, label };
}

/** The view `view` names, held by no key ({@link viewNamed}), else `failure`. */
function unheld(
  r: Resolving,
  view: string,
  shown: Shown,
  failure: string,
): Result.Result<UnheldViewTarget, string> {
  const listed = viewNamed(view, r.catalog, r.lookup);
  return listed === null ? Result.fail(failure) : Result.succeed({ key: null, listed, ...shown });
}

/**
 * One way to open a node: the `view` its `/node/<id>/<view>` location names
 * (a view node's id, or a view type's option; absent, its default), what it
 * is called, and, for a view type, its key, so a host can tell whether it
 * draws that view where it would open.
 */
export interface NodeOpening {
  readonly view?: string;
  readonly label: string;
  readonly key?: ViewKey<unknown>;
  /** The tag whose default view type this is, for one a tag of the node names. */
  readonly tag?: NodeId;
  /** This is what the node opens in by default. */
  readonly default?: true;
}

const quiet: ConfigReport = () => {};

/**
 * Whether `key` is a view a node is shown in: its settings read for a node
 * from an empty view node, and read differently than for none. A family's
 * view is shown inside its host's page, so it is reached through the node's
 * own views instead.
 */
function showsANode(key: ViewKey<unknown>, host: NodeId): boolean {
  if (key === NodeView || key === LayoutView || key.family !== undefined) return false;
  const forHost = paramsFromProps(key, {}, host, quiet);
  if (Result.isFailure(forHost)) return false;
  const forNone = paramsFromProps(key, {}, null, quiet);
  return (
    Result.isFailure(forNone) || canonicalJson(forNone.success) !== canonicalJson(forHost.success)
  );
}

/**
 * What a view node is called: its text, else its view's label, its view
 * named as a node opens it ({@link viewNamed}), so a view a host cannot draw
 * is named too.
 */
function viewNodeLabel(
  id: NodeId,
  catalog: Pick<Catalog, "listedOf">,
  lookup: (id: NodeId) => Carrier | undefined,
): string {
  const node = lookup(id);
  const text = node?.text?.trim() ?? "";
  if (text !== "") return text;
  const option = viewOptionOf(node);
  return (option === null ? null : viewNamed(option, catalog, lookup))?.label ?? id;
}

/**
 * Every way `host` can be opened, in order: its default, each view node it
 * names (its own default first), then each view type of `catalog` a node is
 * shown in, its tags' defaults first (each with the tag it is the default
 * of). The opening the default resolves to (`resolveNodeView`) is marked
 * `default`. One list, so the pane switcher, the node menu and
 * `view.openings` offer the same openings.
 */
export function nodeOpenings(
  host: NodeId,
  catalog: Pick<ViewCatalogOf<CatalogItem>, "items" | "keyOf" | "listedOf">,
  lookup: (id: NodeId) => Carrier | undefined,
): NodeOpening[] {
  const node = lookup(host);
  if (node === undefined) return [];
  const resolved = resolveNodeView({ node: host }, catalog, lookup, quiet);
  const target = Result.isSuccess(resolved) ? resolved.success : null;
  const isDefault = (opening: Omit<NodeOpening, "default">): boolean =>
    target !== null &&
    target.key !== null &&
    (target.viewNode === undefined ? opening.key === target.key : opening.view === target.viewNode);
  const tagOf = new Map<string, NodeId>();
  for (const { tag, option } of tagDefaultViewsOf(node, lookup)) {
    if (!tagOf.has(option)) tagOf.set(option, tag);
  }
  const types = catalog.items
    .filter(({ key }) => showsANode(key, host))
    .map(({ key }) => {
      const tag = tagOf.get(key.option);
      return { view: key.option, label: key.label, key, ...(tag === undefined ? {} : { tag }) };
    });
  const openings: Omit<NodeOpening, "default">[] = [
    ...hostViewIds(node).map((id) => ({ view: id, label: viewNodeLabel(id, catalog, lookup) })),
    ...types.filter((opening) => opening.tag !== undefined),
    ...types.filter((opening) => opening.tag === undefined),
  ];
  return [
    { label: "Default view" },
    ...openings.map((opening) => (isDefault(opening) ? { ...opening, default: true } : opening)),
  ];
}
