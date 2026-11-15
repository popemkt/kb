/**
 * Whether and where a field is drawn, as its field node says (DESIGN.md →
 * Data model → field display): its show option and whether it is pinned.
 * This module is the one reader of both, and of the order they give a list
 * of fields; every surface that draws or lists fields asks it.
 */
import { SYSTEM_IDS, type KbNode, type NodeId, type PropValue } from "./model.ts";
import { seededField } from "./seed-builders.ts";

/** What this module reads of a field node: its props. */
type FieldProps = Readonly<Record<string, readonly PropValue[]>> | undefined;

/**
 * Where a field is drawn on a node that has it: a row always, a row where
 * filled (a chip where empty), a chip, tucked behind the chips' "…", or
 * nowhere but debug.
 */
const FIELD_SHOWS = ["always", "filled", "hidden", "tucked", "never"] as const;
type FieldShow = (typeof FIELD_SHOWS)[number];

/** Each show's option node: a child of `sys.f.show`. */
const FIELD_SHOW_OPTION_IDS: Readonly<Record<FieldShow, NodeId>> = {
  always: SYSTEM_IDS.showAlways,
  filled: SYSTEM_IDS.showFilled,
  hidden: SYSTEM_IDS.showHidden,
  tucked: SYSTEM_IDS.showTucked,
  never: SYSTEM_IDS.showNever,
};

/** Each show's label, as the seed writes its option. */
const FIELD_SHOW_LABELS: Readonly<Record<FieldShow, string>> = {
  always: "always",
  filled: "when filled",
  hidden: "hidden",
  tucked: "tucked",
  never: "never",
};

/**
 * The show field as core's seed declares it, stamped `at`: one value, a ref
 * to one of its own children, which are its options (the option-set shape),
 * followed by those options. `props` adds to the field's own. Then the
 * checkbox show took over from, `sys.f.hidden`: owned (show never) and on no
 * template, so a store seeded before show stops drawing its row, while the
 * values it holds still count (`fieldShowOf`).
 */
export function seededShowField(at: string, props: KbNode["props"] = {}): KbNode[] {
  const options = FIELD_SHOWS.map(
    (show): KbNode => ({
      id: FIELD_SHOW_OPTION_IDS[show],
      text: FIELD_SHOW_LABELS[show],
      props: {},
      children: [],
      createdAt: at,
      updatedAt: at,
    }),
  );
  const field = seededField(SYSTEM_IDS.showField, "show", "ref", at, { one: true, props });
  const retired = seededField(SYSTEM_IDS.hiddenField, "hidden", "checkbox", at, {
    one: true,
    owned: true,
  });
  return [{ ...field, children: options.map((option) => option.id) }, ...options, retired];
}

/**
 * A field node's show: the option its `sys.f.show` names; else hidden where
 * the checkbox show took over from (`sys.f.hidden`) holds `true`, so a store
 * written before show reads as it is, with nothing to migrate; else always.
 */
export function fieldShowOf(props: FieldProps): FieldShow {
  const raw = props?.[SYSTEM_IDS.showField]?.[0];
  const named = FIELD_SHOWS.find(
    (show) => raw?.t === "ref" && FIELD_SHOW_OPTION_IDS[show] === raw.v,
  );
  if (named !== undefined) return named;
  const hid = props?.[SYSTEM_IDS.hiddenField]?.some((value) => value.t === "bool" && value.v);
  return hid === true ? "hidden" : "always";
}

/** Whether a field node says it is pinned. */
function isFieldPinned(props: FieldProps): boolean {
  const raw = props?.[SYSTEM_IDS.pinnedField]?.[0];
  return raw?.t === "bool" && raw.v;
}

/**
 * `items` with the pinned fields first, each part in the order it had: the
 * one order every list of fields takes (a node's rows, the query builder's
 * subjects, the view settings' fields). `fieldOf` names an item's field id.
 */
export function pinnedFirst<T>(
  items: readonly T[],
  fieldOf: (item: T) => NodeId,
  nodeOf: (id: NodeId) => { readonly props: FieldProps } | undefined,
): T[] {
  const pinned = (item: T) => isFieldPinned(nodeOf(fieldOf(item))?.props);
  return [...items.filter(pinned), ...items.filter((item) => !pinned(item))];
}
