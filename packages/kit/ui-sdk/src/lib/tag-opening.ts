/**
 * A node's tag opening (DESIGN-UI.md → Opening a node → a tag's opening):
 * the view its tag opens it in — the resolver's own rule
 * (`heldTagDefaultOf`) over the page's view catalog — when this page draws
 * that view as a page, with how a chooser names it and, where the page draws
 * it as a preview too, the view's preview settings. The editor's row and
 * its node menu both read it here.
 */
import { previewSettingsOf, type NodeId, type PreviewSettings, type PropValue } from "@kb/model";
import { heldTagDefaultOf, ignoreReport, type ViewKey } from "@kb/views";
import type { Contribution } from "@kb/plugin";
import type { ProvidedView } from "./plugins";
import type { ViewPicker } from "./view-key";

interface Carrier {
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}

/** Where a view's key is found by its id: the page's view catalog (`BrowserHost.viewCatalog`). */
export interface KeyCatalog {
  readonly keyOf: (view: string) => ViewKey<unknown> | null;
}

export interface TagOpening {
  /** The tag whose default view type this is. */
  readonly tag: NodeId;
  readonly key: ViewKey<unknown>;
  /** How a chooser names it (`provideView`'s picker), when its view says. */
  readonly picker: ViewPicker | undefined;
  /** The view's preview settings, where this page draws its preview and the store holds them; else null. */
  readonly preview: PreviewSettings | null;
}

/**
 * `node`'s tag opening: the first of its tags' default view types the
 * catalog holds (`heldTagDefaultOf`), when one of `views` (the `ViewPoint`
 * contributions) draws it as a page; else null. Nodes are read through
 * `lookup`.
 */
export function tagOpeningOf(
  node: Carrier | undefined,
  catalog: KeyCatalog,
  views: readonly Contribution<ProvidedView>[],
  lookup: (id: NodeId) => Carrier | undefined,
): TagOpening | null {
  const held = heldTagDefaultOf(node, catalog.keyOf, lookup, ignoreReport);
  if (held === null) return null;
  const provided = views.find(
    ({ value }) => value.key === held.key && value.placements.includes("page"),
  )?.value;
  if (provided === undefined) return null;
  const settings = provided.placements.includes("preview")
    ? previewSettingsOf(held.key.id, lookup)
    : null;
  return {
    tag: held.tag,
    key: held.key,
    picker: provided.picker,
    preview: settings?.shows === true ? settings : null,
  };
}
