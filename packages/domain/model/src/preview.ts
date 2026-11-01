/**
 * Previews (DESIGN.md → View nodes → a tag's view may preview its nodes): a
 * view whose key says it draws a preview (`ViewKey.preview`) gets settings,
 * derived by the fold as fields configuring the node of the family that
 * provides it, so they are edited where its other settings are. This module
 * is the one home of their ids, their defaults and how they are read; which
 * node holds them is read off the fields themselves (`sys.f.configures`),
 * never guessed from a name.
 */
import { SYSTEM_IDS, extensionNodeId, type KbNode, type NodeId, type PropValue } from "./model.ts";
import { seededField } from "./seed.ts";

/** What this module reads of a node: its props. */
interface Carrier {
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}

/** The preview settings' field ids for the view `viewId`, derived from it. */
export function previewSettingIds(viewId: string): {
  readonly shows: NodeId;
  readonly expanded: NodeId;
  readonly height: NodeId;
} {
  const base = `sys.f.preview.${viewId}`;
  return { shows: base, expanded: `${base}.expanded`, height: `${base}.height` };
}

/** A view's preview settings, as read. */
export interface PreviewSettings {
  /** The view draws previews at all. */
  readonly shows: boolean;
  /** A node whose own toggle says nothing starts with its preview open. */
  readonly expanded: boolean;
  /** How tall a preview stands, CSS pixels: fixed, so it never shifts the outline. */
  readonly height: number;
}

/** What the fold seeds the settings with. */
export const PREVIEW_DEFAULTS: PreviewSettings = { shows: true, expanded: false, height: 180 };

/** The bounds a preview's height is held to, CSS pixels. */
const HEIGHT_BOUNDS = { min: 60, max: 600 } as const;

/**
 * The setting fields the fold derives for a view that previews, each one
 * value and each configuring the node of `family`, the family that provides
 * it. They are named for what they say under that family's heading.
 */
export function previewSettingFields(viewId: string, family: string, at: string): KbNode[] {
  const ids = previewSettingIds(viewId);
  const setting = {
    one: true,
    props: { [SYSTEM_IDS.configuresField]: [{ t: "ref" as const, v: extensionNodeId(family) }] },
  };
  return [
    seededField(ids.shows, "previews", "checkbox", at, setting),
    seededField(ids.expanded, "previews open", "checkbox", at, setting),
    seededField(ids.height, "preview height", "number", at, setting),
  ];
}

/**
 * The settings' values as the fold seeds them on the family's node: the
 * defaults, so its settings show what is in effect, and a store seeded
 * before them is given them when it opens.
 */
export function previewSettingValues(viewId: string): KbNode["props"] {
  const ids = previewSettingIds(viewId);
  return {
    [ids.shows]: [{ t: "bool", v: PREVIEW_DEFAULTS.shows }],
    [ids.expanded]: [{ t: "bool", v: PREVIEW_DEFAULTS.expanded }],
    [ids.height]: [{ t: "num", v: PREVIEW_DEFAULTS.height }],
  };
}

function boolOf(node: Carrier | undefined, field: NodeId): boolean | undefined {
  const value = node?.props[field]?.[0];
  return value?.t === "bool" ? value.v : undefined;
}

/**
 * The preview settings of the view `viewId`, or null when the store holds
 * none (its family is off, or the view draws no preview): read from the node
 * its settings configure (`lookup` reads a node). A setting with no value
 * reads as its default.
 */
export function previewSettingsOf(
  viewId: string,
  lookup: (id: NodeId) => Carrier | undefined,
): PreviewSettings | null {
  const ids = previewSettingIds(viewId);
  const holder = lookup(ids.shows)?.props[SYSTEM_IDS.configuresField]?.[0];
  if (holder?.t !== "ref") return null;
  const node = lookup(holder.v);
  const height = node?.props[ids.height]?.[0];
  return {
    shows: boolOf(node, ids.shows) ?? PREVIEW_DEFAULTS.shows,
    expanded: boolOf(node, ids.expanded) ?? PREVIEW_DEFAULTS.expanded,
    height:
      height?.t === "num" && Number.isFinite(height.v)
        ? Math.min(HEIGHT_BOUNDS.max, Math.max(HEIGHT_BOUNDS.min, Math.round(height.v)))
        : PREVIEW_DEFAULTS.height,
  };
}
