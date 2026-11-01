/**
 * A row's tag opening as the editor uses it (DESIGN-UI.md → Opening a node
 * → a tag's opening): `tagOpeningOf` over the page's catalog and views, with
 * the view's label and its picker's icon; the step that opens the node in
 * it; and the node's preview toggle, which this family seeds
 * (`OUTLINE_IDS.previewField`) and is the one place that reads or writes.
 */
import { createElement, useMemo, type ReactNode } from "react";
import type { NodeId, PreviewSettings, PropValue } from "@kb/model";
import { OUTLINE_IDS } from "@kb/outline";
import type { ViewKey } from "@kb/views";
import {
  browserHost,
  nodePath,
  tagOpeningOf,
  useContributions,
  useGraphRead,
  ViewPoint,
  type OutlineNode,
  type TagOpening,
} from "@kb/ui-sdk";

/** A row's tag opening (`tagOpeningOf`), with its label and its icon drawn. */
export interface RowOpening extends TagOpening {
  readonly label: string;
  readonly icon: ReactNode;
}

/** The tag opening of `node`'s row, or null when no tag of it names a view this page draws. */
export function useRowOpening(node: OutlineNode | undefined): RowOpening | null {
  const { schema } = useGraphRead();
  const views = useContributions(ViewPoint);
  return useMemo(() => {
    const opening = tagOpeningOf(node, browserHost().viewCatalog(), views, (id) => schema.get(id));
    if (opening === null) return null;
    const Icon = opening.picker?.icon;
    return {
      ...opening,
      label: opening.key.label,
      icon:
        Icon === undefined
          ? null
          : createElement(Icon, { size: 12, weight: opening.picker?.iconWeight }),
    };
  }, [node, schema, views]);
}

/** Open `node` in `view` in pane `pane`: the node menu's "Open with" for that view. */
export function openIn(pane: string, node: NodeId, view: ViewKey<unknown>): void {
  browserHost().navigatePane(pane, nodePath(node, view.option));
}

interface Carrier {
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}

/** Whether `node`'s preview is open: its own toggle, else its view's `previews open`. */
export function previewShownOf(node: Carrier | undefined, settings: PreviewSettings): boolean {
  const own = node?.props[OUTLINE_IDS.previewField]?.[0];
  return settings.shows && (own?.t === "bool" ? own.v : settings.expanded);
}

/** Open or close `node`'s preview: its own toggle, a field like any other. */
export function setPreviewShown(node: NodeId, shown: boolean): void {
  void browserHost().writes.replaceField(node, OUTLINE_IDS.previewField, [{ t: "bool", v: shown }]);
}
