/**
 * A row's tag opening as the editor uses it (DESIGN-UI.md → Opening a node
 * → a tag's opening): `tagOpeningOf` over the page's catalog and views, with
 * the view's label and its picker's icon; the step that opens the node in
 * it; and the node's display options — whether each is on for it, and the
 * node's own toggle of each, which this family seeds
 * (`OUTLINE_IDS.displayFields`) and this module alone reads and writes.
 */
import { createElement, useMemo, type ReactNode } from "react";
import { eachDisplayOption, type DisplayOption, type NodeId, type PropValue } from "@kb/model";
import { OUTLINE_IDS } from "@kb/outline";
import type { ViewKey } from "@kb/views";
import {
  browserHost,
  nodePath,
  SYSTEM_IDS,
  tagOpeningOf,
  useContributions,
  useGraphRead,
  ViewPoint,
  type OutlineNode,
  type TagOpening,
} from "@kb/ui-sdk";

/**
 * A row's tag opening (`tagOpeningOf`), with its label and its icon drawn,
 * which display options are on for the node, and the hidden fields its
 * properties reveal: the fields of the tag that opens it, which that view
 * draws instead, when its properties show.
 */
export interface RowOpening extends TagOpening {
  readonly label: string;
  readonly icon: ReactNode;
  readonly shown: Readonly<Record<DisplayOption, boolean>>;
  readonly revealed: ReadonlySet<string>;
}

/** The tag opening of `node`'s row, or null when no tag of it names a view this page draws. */
export function useRowOpening(node: OutlineNode | undefined): RowOpening | null {
  const { schema } = useGraphRead();
  const views = useContributions(ViewPoint);
  return useMemo(() => {
    const opening = tagOpeningOf(node, browserHost().viewCatalog(), views, (id) => schema.get(id));
    if (opening === null) return null;
    const Icon = opening.picker?.icon;
    const shown = eachDisplayOption((option) => displayShownOf(node, opening, option));
    const template = schema.get(opening.tag)?.props[SYSTEM_IDS.fieldsField] ?? [];
    return {
      ...opening,
      label: opening.key.label,
      icon:
        Icon === undefined
          ? null
          : createElement(Icon, { size: 12, weight: opening.picker?.iconWeight }),
      shown,
      revealed: new Set(
        shown.properties ? template.flatMap((ref) => (ref.t === "ref" ? [ref.v] : [])) : [],
      ),
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

/**
 * Whether `option` is on for `node`, whose tag opening is `opening`: never
 * where the opening does not offer it; else the node's own toggle, and
 * where the node says nothing, its view's family's setting (`always`).
 */
export function displayShownOf(
  node: Carrier | undefined,
  opening: TagOpening | null,
  option: DisplayOption,
): boolean {
  if (opening === null || !opening.options.includes(option)) return false;
  const own = node?.props[OUTLINE_IDS.displayFields[option]]?.[0];
  return own?.t === "bool" ? own.v : opening.settings[option] === "always";
}

/** Turn `option` on or off for `node`: its own toggle, a field like any other. */
export function setDisplayShown(node: NodeId, option: DisplayOption, shown: boolean): void {
  void browserHost().writes.replaceField(node, OUTLINE_IDS.displayFields[option], [
    { t: "bool", v: shown },
  ]);
}
