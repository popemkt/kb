/**
 * A node's tag opening (DESIGN-UI.md → Opening a node → a tag's opening):
 * the view its tag opens it in — the resolver's own rule
 * (`heldTagDefaultOf`) over the page's view catalog — when this page draws
 * that view as a page, with how a chooser names it, the display options it
 * offers the node here and its family's settings for them (`@kb/model`'s
 * `display.ts`). The editor's row and its node menu both read it here.
 */
import {
  displayOptionsOf,
  displaySettingsOf,
  type DisplayOption,
  type DisplaySettings,
  type NodeId,
  type PropValue,
} from "@kb/model";
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
  /**
   * The display options the node is offered here: the preview where the
   * view's key draws one and this page draws it (placement `preview`), and
   * its properties.
   */
  readonly options: readonly DisplayOption[];
  /** Its family's settings for them (`displaySettingsOf`). */
  readonly settings: DisplaySettings;
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
  return {
    tag: held.tag,
    key: held.key,
    picker: provided.picker,
    options: displayOptionsOf({
      id: held.key.id,
      preview: provided.placements.includes("preview"),
    }),
    settings: displaySettingsOf(held.key.id, lookup),
  };
}
