/**
 * How a node a tag opens in a view is shown in the outline (DESIGN.md → View
 * nodes → a tag's view sets how its nodes show): a small set of display
 * options, each one the node may ask for on its own and each with a default
 * its view's family sets. The options are `preview` (the view draws the node
 * small under its row; only a view whose key draws previews offers it) and
 * `properties` (the node's fields show as a plain node's do, the ones its tag
 * hides for the view included).
 *
 * A family's settings are derived by the fold for each view it claims as a
 * tag's default view: per option, one option field — "when a node asks" or
 * "always" — and for the preview its height, each configuring the family's
 * node. This module is the one home of their ids, their options, their
 * defaults and how they are read; which node holds them is read off the
 * fields (`sys.f.configures`), never guessed from a name, and settings a
 * store does not hold read as the defaults.
 */
import { SYSTEM_IDS, extensionNodeId, type KbNode, type NodeId, type PropValue } from "./model.ts";
import { seededField } from "./seed.ts";

/** What this module reads of a node: its props. */
interface Carrier {
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}

/** The display options, in the order a menu offers them. */
export const DISPLAY_OPTIONS = ["preview", "properties"] as const;
export type DisplayOption = (typeof DISPLAY_OPTIONS)[number];

/** One value per display option, `of` each: the record a reader of all of them holds. */
export function eachDisplayOption<T>(
  of: (option: DisplayOption) => T,
): Readonly<Record<DisplayOption, T>> {
  return { preview: of("preview"), properties: of("properties") };
}

/** When an option is on for a node that does not say: only when it asks, or always. */
const DISPLAY_DEFAULT_VALUES = ["asked", "always"] as const;
export type DisplayDefault = (typeof DISPLAY_DEFAULT_VALUES)[number];

const DEFAULT_LABELS: Readonly<Record<DisplayDefault, string>> = {
  asked: "when a node asks",
  always: "always",
};

/** What a view in the role of a tag's default view offers its nodes, as one view key says it. */
export interface DisplayView {
  readonly id: string;
  /** The view draws a preview of a node it opens (`ViewKey.preview`). */
  readonly preview?: boolean | undefined;
}

/** The options `view` offers: the preview only where it draws one. */
export function displayOptionsOf(view: DisplayView): readonly DisplayOption[] {
  return DISPLAY_OPTIONS.filter((option) => option !== "preview" || view.preview === true);
}

/** The setting field ids for the view `viewId`, derived from it. */
export function displaySettingIds(viewId: string): Readonly<Record<DisplayOption, NodeId>> & {
  readonly height: NodeId;
} {
  const base = `sys.f.display.${viewId}`;
  return {
    preview: `${base}.preview`,
    properties: `${base}.properties`,
    height: `${base}.preview.height`,
  };
}

/** The option node of `setting` (a setting field's id) that says `value`: the field's child. */
export function displayDefaultId(setting: NodeId, value: DisplayDefault): NodeId {
  return `${setting}.${value}`;
}

/** A view's display settings, as read. */
export interface DisplaySettings {
  readonly preview: DisplayDefault;
  readonly properties: DisplayDefault;
  /** How tall a preview stands, CSS pixels: fixed, so it never shifts the outline. */
  readonly height: number;
}

/** What the fold seeds, and what settings a store does not hold read as. */
export const DISPLAY_DEFAULTS: DisplaySettings = {
  preview: "asked",
  properties: "asked",
  height: 180,
};

/** The bounds a preview's height is held to, CSS pixels. */
const HEIGHT_BOUNDS = { min: 60, max: 600 } as const;

const LABELS: Readonly<Record<DisplayOption, string>> = {
  preview: "inline preview",
  properties: "properties",
};

/**
 * The setting fields the fold derives for `view`, a view `family` claims as
 * a tag's default view: one option field per option it offers, its options
 * its children, and the preview's height where it previews; each holds one
 * value and configures the family's node, so it is set where the family's
 * other settings are.
 */
export function displaySettingFields(view: DisplayView, family: string, at: string): KbNode[] {
  const ids = displaySettingIds(view.id);
  const setting = {
    one: true,
    props: { [SYSTEM_IDS.configuresField]: [{ t: "ref" as const, v: extensionNodeId(family) }] },
  };
  const options = displayOptionsOf(view).flatMap((option) => {
    const values = DISPLAY_DEFAULT_VALUES.map(
      (value): KbNode => ({
        id: displayDefaultId(ids[option], value),
        text: DEFAULT_LABELS[value],
        props: {},
        children: [],
        createdAt: at,
        updatedAt: at,
      }),
    );
    return [
      {
        ...seededField(ids[option], LABELS[option], "ref", at, setting),
        children: values.map(({ id }) => id),
      },
      ...values,
    ];
  });
  return view.preview === true
    ? [...options, seededField(ids.height, "preview height", "number", at, setting)]
    : options;
}

/**
 * The settings' values as the fold seeds them on the family's node: the
 * defaults, so its settings show what is in effect, and a store seeded
 * before them is given them when it opens.
 */
export function displaySettingValues(view: DisplayView): KbNode["props"] {
  const ids = displaySettingIds(view.id);
  const props: KbNode["props"] = Object.fromEntries(
    displayOptionsOf(view).map((option) => [
      ids[option],
      [{ t: "ref", v: displayDefaultId(ids[option], DISPLAY_DEFAULTS[option]) }],
    ]),
  );
  return view.preview === true
    ? { ...props, [ids.height]: [{ t: "num", v: DISPLAY_DEFAULTS.height }] }
    : props;
}

/** The default `node` holds for the setting `field`; absent or foreign, none. */
function defaultOf(node: Carrier | undefined, field: NodeId): DisplayDefault | undefined {
  const value = node?.props[field]?.[0];
  if (value?.t !== "ref") return undefined;
  return value.v === displayDefaultId(field, "always")
    ? "always"
    : value.v === displayDefaultId(field, "asked")
      ? "asked"
      : undefined;
}

/**
 * The display settings of the view `viewId`, read from the node its settings
 * configure (`lookup` reads a node); a setting the store does not hold (its
 * family is off, or no family claims the view) reads as its default.
 */
export function displaySettingsOf(
  viewId: string,
  lookup: (id: NodeId) => Carrier | undefined,
): DisplaySettings {
  const ids = displaySettingIds(viewId);
  const holderOf = (field: NodeId): Carrier | undefined => {
    const holder = lookup(field)?.props[SYSTEM_IDS.configuresField]?.[0];
    return holder?.t === "ref" ? lookup(holder.v) : undefined;
  };
  const height = holderOf(ids.height)?.props[ids.height]?.[0];
  return {
    preview: defaultOf(holderOf(ids.preview), ids.preview) ?? DISPLAY_DEFAULTS.preview,
    properties: defaultOf(holderOf(ids.properties), ids.properties) ?? DISPLAY_DEFAULTS.properties,
    height:
      height?.t === "num" && Number.isFinite(height.v)
        ? Math.min(HEIGHT_BOUNDS.max, Math.max(HEIGHT_BOUNDS.min, Math.round(height.v)))
        : DISPLAY_DEFAULTS.height,
  };
}
