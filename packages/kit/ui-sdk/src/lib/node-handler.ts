/**
 * A node's handler (DESIGN-UI.md → Opening a node → a row's handler): the
 * view its tag opens it in that this page draws as a page — the resolver's
 * own rule (`heldTagDefaultOf`), over the views the page's plugins provide —
 * with how a chooser names it and, where its family draws it `inline` and
 * shows previews, that family's preview settings. The outline's row and the
 * node menu both read it here.
 */
import { previewSettingsOf, type NodeId, type PreviewSettings, type PropValue } from "@kb/model";
import { heldTagDefaultOf, type ViewKey } from "@kb/views";
import type { Contribution } from "@kb/plugin";
import type { ProvidedView } from "./plugins";
import type { ViewPicker } from "./view-key";

interface Carrier {
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}

export interface NodeHandler {
  readonly key: ViewKey<unknown>;
  /** How a chooser names it (`provideView`'s picker), when its view says. */
  readonly picker: ViewPicker | undefined;
  /** Its family's preview settings, where the family draws it inline and shows previews; else null. */
  readonly preview: PreviewSettings | null;
}

const quiet = (): void => {};

/** `node`'s handler among `views` (the `ViewPoint` contributions), reading nodes through `lookup`. */
export function nodeHandlerOf(
  node: Carrier | undefined,
  views: readonly Contribution<ProvidedView>[],
  lookup: (id: NodeId) => Carrier | undefined,
): NodeHandler | null {
  const paged = (view: string) =>
    views.find(
      ({ value }) =>
        (value.key.id === view || value.key.option === view) && value.placements.includes("page"),
    );
  const held = heldTagDefaultOf(node, (view) => paged(view)?.value.key ?? null, lookup, quiet);
  const provided = held === null ? undefined : paged(held.key.id);
  if (held === null || provided === undefined) return null;
  // The family that draws the view is its contribution's owner: its node holds the settings.
  const settings = previewSettingsOf(provided.owner, lookup);
  return {
    key: held.key,
    picker: provided.value.picker,
    preview: provided.value.placements.includes("inline") && settings.shows ? settings : null,
  };
}
