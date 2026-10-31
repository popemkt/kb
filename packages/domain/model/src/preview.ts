/**
 * Inline previews (DESIGN.md → View nodes → inline previews): a family that
 * declares `inlinePreview` draws a compact read-only rendering of a node its
 * tag opens in, under the node's row. Whether it does, whether a preview
 * starts open and how tall it stands are that family's settings — fields
 * the fold derives for it here, each configuring its node, so they are
 * edited where its other settings are. Whether one node's preview is open
 * is that node's `sys.f.preview`. This module is the one home of the
 * fields' ids, their defaults and how they are read.
 */
import { SYSTEM_IDS, extensionNodeId, type KbNode, type NodeId, type PropValue } from "./model.ts";
import { seededField } from "./seed.ts";

/** What this module reads of a node: its props. */
interface Carrier {
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}

/** The preview settings' field ids for family `family`, derived from its name. */
export function previewSettingIds(family: string): {
  readonly shows: NodeId;
  readonly expanded: NodeId;
  readonly height: NodeId;
} {
  const base = `sys.f.${family}.preview`;
  return { shows: base, expanded: `${base}.expanded`, height: `${base}.height` };
}

/** A family's preview settings, as read: what each holds, else its default. */
export interface PreviewSettings {
  /** The family draws inline previews at all. Default: yes. */
  readonly shows: boolean;
  /** A node whose own toggle says nothing starts with its preview open. Default: no. */
  readonly expanded: boolean;
  /** How tall a preview stands, CSS pixels: fixed, so it never shifts the outline. Default: 180. */
  readonly height: number;
}

export const PREVIEW_DEFAULTS: PreviewSettings = { shows: true, expanded: false, height: 180 };

/** The bounds a preview's height is held to, CSS pixels. */
const HEIGHT_BOUNDS = { min: 60, max: 600 } as const;

/**
 * The three setting fields the fold derives for a family that declares
 * `inlinePreview`, each one value and each configuring the family's node.
 * They are named for what they say under the family's own heading.
 */
export function previewSettingFields(family: string, at: string): KbNode[] {
  const ids = previewSettingIds(family);
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
export function previewSettingValues(family: string): KbNode["props"] {
  const ids = previewSettingIds(family);
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

/** `family`'s preview settings, read from its node (`lookup` reads a node). */
export function previewSettingsOf(
  family: string,
  lookup: (id: NodeId) => Carrier | undefined,
): PreviewSettings {
  const ids = previewSettingIds(family);
  const node = lookup(extensionNodeId(family));
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

/** Whether `node`'s preview is open: its own toggle, else the family's `expanded`. */
export function previewShownOf(node: Carrier | undefined, settings: PreviewSettings): boolean {
  return settings.shows && (boolOf(node, SYSTEM_IDS.previewField) ?? settings.expanded);
}
