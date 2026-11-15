/**
 * The view point (DESIGN-UI.md → UI points: routes and views): what a view
 * is, how a plugin contributes one under its key, and how a key reads its
 * view back from a kernel.
 */
import type { FunctionComponent, ReactNode } from "react";
import { CORE_POINT_DEFINITIONS } from "@kb/contracts";
import { Point, type Contribution, type ContributionEntry, type Kernel } from "@kb/plugin";
import { present } from "@kb/model";
import { localIdOf, type PlainViewKey, type ViewKey } from "@kb/views";
import type { RouteFrame } from "./route-point.ts";
import type { FamilyView, ViewPicker } from "./view-key";

/**
 * Where a host renders a view: `page` fills the box the host gives it (the
 * shell's page, the graph's canvas); `inline` sits in the outline's flow,
 * under the row of the frame whose children it lays out; `preview` is a
 * compact, read-only picture of a node under its row, in a box of fixed
 * height, which a view offers exactly when its key says it draws one
 * (`ViewKey.preview`, {@link provideView}); `row` is a node's row itself, in
 * place of its text while no one edits it, where a tag names the view its
 * nodes are drawn as (`sys.f.view.row`), handed the row it draws
 * ({@link ViewHost.row}). The rest of the placements wait on their first
 * host: GAP [[01M3EZR20H0CDF5MD01M2S26C5]].
 */
export type Placement = "page" | "inline" | "preview" | "row";

/** The placements a contribution lists itself: `preview` is its key's to say. */
type ListedPlacement = Exclude<Placement, "preview">;

/**
 * The row a view at placement `row` draws (DESIGN-UI.md → Row views): the
 * node the row shows and its text, which is all of the graph such a view is
 * handed. `text` is that text as the outline draws it, references as pills,
 * and pressing it edits the row where it was pressed, so a view places it
 * rather than drawing the markdown itself.
 */
export interface RowSubject {
  readonly id: string;
  /** The text as written: inline markdown, a reference as `[[id|label]]`. */
  readonly markdown: string;
  readonly text: ReactNode;
}

/**
 * Where a host draws a view, with what it hands the view there: at `row`,
 * the row it draws; at every other placement, no row. One union, so a slot
 * at `row` without its row, or a row handed to a page, does not type.
 */
export type Drawn =
  | { readonly placement: "row"; readonly row: RowSubject }
  | { readonly placement: Exclude<Placement, "row">; readonly row?: undefined };

/** What a host guarantees a view: never a store, never `ctx`. */
export type ViewHost = Drawn & {
  /**
   * The view node the host draws the view from, when it draws one (the node
   * route opening a view node): where a view that edits its own settings
   * writes them. Absent for a view drawn from a view type or from code.
   */
  readonly viewNode?: string;
};

export interface ViewProps<P> {
  readonly params: P;
  readonly host: ViewHost;
}

export interface View<P> {
  readonly key: ViewKey<P>;
  readonly placements: readonly Placement[];
  /** The params the view contract mounts this view with. */
  readonly sample: P;
  readonly Component: FunctionComponent<ViewProps<P>>;
  /** How a picker names it, for a view of a family a host chooses between. */
  readonly picker?: ViewPicker;
  /**
   * How a page it is the whole of is framed where no route opens it (a node
   * opened in it, `/node/<id>`): a view a route opens is framed as that route
   * frames it ({@link pageFrameOf}). Default: `fixed`, a page with its own
   * viewport.
   */
  readonly frame?: RouteFrame;
}

/**
 * A view as the point holds it, its params erased so views of every `P` share
 * one point. Only {@link findView} reads one back as a `View<P>`.
 */
export interface ProvidedView {
  readonly key: ViewKey<unknown>;
  readonly placements: readonly Placement[];
  readonly sample: unknown;
  readonly Component: FunctionComponent<ViewProps<never>>;
  readonly picker?: ViewPicker;
  readonly frame?: RouteFrame;
}

export const ViewPoint = Point<ProvidedView>()(
  CORE_POINT_DEFINITIONS.view.name,
  CORE_POINT_DEFINITIONS.view.spec,
);

/** What a view contribution says beside its key: its placements but `preview`, which the key says. */
type ViewEntry<P> = Omit<View<P>, "key" | "placements"> & {
  readonly placements: readonly ListedPlacement[];
};

/**
 * The `ViewPoint` contribution for `key`, under the key's own local id. A
 * view of a family (its key names a `family`) must say how a picker names
 * it: its pickers list it by nothing else. A view of no family may say so
 * too, for where a node is opened in it ("Open in …", "Open with…"). It is
 * offered at `preview` too when its key draws a preview (`ViewKey.preview`),
 * so its component is drawn there with `host.placement === "preview"`.
 */
export function provideView<P>(
  key: ViewKey<P> & { readonly family: string },
  view: Omit<ViewEntry<P>, "picker"> & { readonly picker: ViewPicker },
): ContributionEntry<ProvidedView>;
export function provideView<P>(
  key: PlainViewKey<P>,
  view: ViewEntry<P>,
): ContributionEntry<ProvidedView>;
export function provideView<P>(
  key: ViewKey<P>,
  view: ViewEntry<P>,
): ContributionEntry<ProvidedView> {
  const placements: readonly Placement[] =
    key.preview !== null ? [...view.placements, "preview"] : view.placements;
  const provided: View<P> = { key, ...view, placements };
  return { id: localIdOf(key), value: provided };
}

/**
 * The provided views of one family, as its pickers list them: each view whose
 * key `isFamily` admits and whose contribution names it (`picker`), in
 * `picker.order`. The one way a family is enumerated, so a picker, a decode
 * and a walk all see the same views.
 */
export function familyViews<K extends ViewKey<unknown>>(
  views: readonly Contribution<ProvidedView>[],
  isFamily: (key: ViewKey<unknown>) => key is K,
): readonly FamilyView<K>[] {
  const listed: FamilyView<K>[] = [];
  for (const { value } of views) {
    if (!isFamily(value.key)) continue;
    // `provideView` requires a family view's picker, so none is ever missing.
    const picker = present(value.picker, `${value.key.id} is a family view with no picker`);
    listed.push({ key: value.key, picker });
  }
  return listed.toSorted((a, b) => a.picker.order - b.picker.order);
}

/*
 * The view points' one trust, in its two readings: an erased view, and a
 * matched route's params, read as the `P` their key stands for. Sound
 * because each was typed by this very key object on the way in
 * (`provideView`, `provideRoute`), and each caller has just checked that
 * identity — the trust `asKeyType` spends in the kernel.
 */
function asViewOf<P>(_key: ViewKey<P>, view: ProvidedView): View<P> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typed by this very key in provideView; identity checked by the caller
  return view as unknown as View<P>;
}

/**
 * The view `kernel` provides under `key`; null when none is, or one made with
 * another key object. A view answers to its key's id through the kernel's
 * own lookup: the id it was contributed at, or, for a view whose frozen id
 * another family's namespace first stored, an alias.
 */
export function findView<P>(kernel: Pick<Kernel, "lookup">, key: ViewKey<P>): View<P> | null {
  const provided = kernel.lookup(ViewPoint, key.id)?.value;
  return provided?.key === key ? asViewOf(key, provided) : null;
}
