/**
 * How a frame view lays a frame's rows out, by the settings it reads: the
 * narrowing every frame view applies, the field columns and sort of a view
 * that shows rows as a table, and the columns a field groups rows into, in
 * the order they flatten to. Which view a frame is shown
 * in, and the settings its view node holds, are `frameViewOf` and
 * `frameConfigOf`.
 */
import { longDay } from "@kb/calendar-kit";
import {
  addDays,
  declaresOptionSet,
  formatDay,
  parseDay,
  templateFieldsOf,
  SYSTEM_IDS,
} from "@kb/model";
import { conditionGraph, conditionsMatcher, derivedWith } from "../query";
import type { SortSpec, ViewFilter } from "@kb/views";
import type { OutlineNode, PropValue } from "./types";
import { textOr } from "./text";
import type { SchemaIndex } from "./schema";
import { isFieldHidden } from "./field-visibility";

function propValueKey(v: PropValue, _schema: SchemaIndex): string {
  if (v.t === "ref") return `ref:${v.v}`;
  if (v.t === "bool") return `bool:${v.v ? 1 : 0}`;
  if (v.t === "num") return `num:${v.v}`;
  return `str:${v.v}`;
}

function propValueLabel(v: PropValue, schema: SchemaIndex): string {
  if (v.t === "ref") return textOr(schema.get(v.v)?.text, v.v);
  if (v.t === "bool") return v.v ? "true" : "false";
  return String(v.v);
}

/**
 * A view's narrowing applied to a frame's rows (`ViewFilter`, ANDed): the
 * condition model's evaluator over the whole graph, so a ref's label is read
 * from its node wherever it sits. Empty filters = identity. The graph's
 * reference relation is read by the core carriers, the ones frameRows can
 * reach. GAP [[01M5E7RM5EQ2TSJZSMM330T5DH]]
 */
export function applyViewFilters(
  children: OutlineNode[],
  filters: readonly ViewFilter[],
  schema: SchemaIndex,
): OutlineNode[] {
  if (filters.length === 0) return children;
  return children.filter(conditionsMatcher(filters, conditionGraph(schema, derivedWith({}))));
}

export interface TableColumnSpec {
  fieldId: string;
  label: string;
}

/** A field id paired with the label a column header shows. */
function toColumnSpec(fieldId: string, schema: SchemaIndex): TableColumnSpec {
  return { fieldId, label: textOr(schema.get(fieldId)?.text, fieldId) };
}

/**
 * The columns the frame names for itself, or null when it names none.
 *
 * `null` rather than `[]` on purpose: a frame that names only hidden fields
 * has *made a choice*, and showing no columns is that choice honoured. See
 * {@link mergeColumns}.
 *
 * A named field is kept unless its node hides it: naming one is itself the
 * decision that it belongs on the table.
 */
function explicitColumns(
  display: readonly string[],
  schema: SchemaIndex,
  showDebugColumns: boolean,
): TableColumnSpec[] | null {
  if (display.length === 0) return null;
  return display
    .filter((fieldId) => showDebugColumns || !isFieldHidden(fieldId, schema))
    .map((fieldId) => toColumnSpec(fieldId, schema));
}

/**
 * The columns the projected rows' own tags imply, in first-seen order.
 *
 * Nobody asked for these, so a field its node hides is not offered by
 * derivation, as it has no row on the page either.
 */
function derivedColumns(
  children: readonly OutlineNode[],
  schema: SchemaIndex,
  showDebugColumns: boolean,
): TableColumnSpec[] {
  const seen = new Set<string>();
  const columns: TableColumnSpec[] = [];
  for (const child of children) {
    const tags = child.tags.map((tag) => tag.id);
    for (const field of templateFieldsOf(tags, (id) => schema.get(id))) {
      if (seen.has(field)) continue;
      seen.add(field);
      if (!showDebugColumns && isFieldHidden(field, schema)) continue;
      columns.push(toColumnSpec(field, schema));
    }
  }
  return columns;
}

/**
 * The precedence, in one place: naming columns on the frame replaces
 * derivation outright. It used to be implicit in statement order.
 */
function mergeColumns(
  explicit: TableColumnSpec[] | null,
  derived: () => TableColumnSpec[],
): TableColumnSpec[] {
  return explicit ?? derived();
}

export function resolveTableColumns(
  viewConfig: { readonly display: readonly string[] },
  children: OutlineNode[],
  schema: SchemaIndex,
  showDebugColumns = false,
): TableColumnSpec[] {
  return mergeColumns(explicitColumns(viewConfig.display, schema, showDebugColumns), () =>
    derivedColumns(children, schema, showDebugColumns),
  );
}

/**
 * Reading one sort key off a row.
 *
 * The node's text is a field (`sys.f.node.text`) whose value is read off the
 * node rather than its props — not a branch in the comparator: once it
 * resolves to a `PropValue` like any other key, one ordering rule serves both,
 * and "the name is never missing" stops being a special case.
 */
const PSEUDO_FIELDS: Readonly<Record<string, (node: OutlineNode) => PropValue>> = {
  [SYSTEM_IDS.nodeTextField]: (node) => ({ t: "str", v: node.text }),
};

function sortValueOf(node: OutlineNode, fieldId: string): PropValue | undefined {
  const pseudo = PSEUDO_FIELDS[fieldId];
  if (pseudo) return pseudo(node);
  // Display and drag both take the first value; so does ordering.
  return node.props[fieldId]?.[0];
}

function byLowerString(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * A value type's sort key: one row per type, which is what the comparator's
 * `else if` ladder made invisible. Numbers stay numbers so 10 sorts after 9;
 * everything else compares as a lowercased string.
 */
type SortKey = number | string;

const SORT_KEY: Readonly<
  Record<PropValue["t"], (value: PropValue, schema: SchemaIndex) => SortKey>
> = {
  num: (value) => Number(value.v),
  bool: (value) => (value.v === true ? 1 : 0),
  ref: (value, schema) => textOr(schema.get(String(value.v))?.text, String(value.v)).toLowerCase(),
  str: (value) => String(value.v).toLowerCase(),
  date: (value) => String(value.v).toLowerCase(),
};

function compareKeys(a: SortKey, b: SortKey): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return byLowerString(String(a), String(b));
}

/**
 * Two rows' values for one key.
 *
 * A missing value sorts last — before the direction is applied, so descending
 * puts it first. Two values of *different* types are compared as their raw
 * strings rather than through either one's key: a ref mixed with a string has
 * no shared ordering, and reaching for the ref's resolved text there would be
 * inventing one.
 */
function compareValues(
  a: PropValue | undefined,
  b: PropValue | undefined,
  schema: SchemaIndex,
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.t !== b.t) return byLowerString(String(a.v), String(b.v));
  return compareKeys(SORT_KEY[a.t](a, schema), SORT_KEY[b.t](b, schema));
}

type RowComparator = (a: OutlineNode, b: OutlineNode) => number;

/** One sort key, in one direction. */
function compareByField(spec: SortSpec, schema: SchemaIndex): RowComparator {
  return (a, b) => {
    const cmp = compareValues(sortValueOf(a, spec.fieldId), sortValueOf(b, spec.fieldId), schema);
    return spec.dir === "asc" ? cmp : -cmp;
  };
}

/** First key that separates two rows wins; ties fall through to the next. */
function composeComparators(comparators: readonly RowComparator[]): RowComparator {
  return (a, b) => {
    for (const compare of comparators) {
      const cmp = compare(a, b);
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
}

export function sortChildrenForTable(
  children: OutlineNode[],
  sortSpecs: readonly SortSpec[],
  schema: SchemaIndex,
): OutlineNode[] {
  if (sortSpecs.length === 0) return children;
  return children.toSorted(
    composeComparators(sortSpecs.map((spec) => compareByField(spec, schema))),
  );
}

export const EMPTY_GROUP_KEY = "__empty__";

export interface BoardColumn {
  /** The group's key, which a view's `collapsed` names it by (DESIGN-UI.md → Groups). */
  key: string;
  label: string;
  /** Prop value for this column; null = "No <field>" empty column. */
  value: PropValue | null;
  nodes: OutlineNode[];
  /** Folded: its header and count are drawn, its rows are not. */
  collapsed: boolean;
}

function group(key: string, label: string, value: PropValue | null): BoardColumn {
  return { key, label, value, nodes: [], collapsed: false };
}

/**
 * Group rows by a field's values (DESIGN-UI.md → Groups): a group per option
 * of a field that declares its option set, in the field's order, held or
 * not; then each other value held, by label; then "No <field>". A row falls
 * in the group of its first value. When groupFieldId is null (cards),
 * returns a single unlabeled column.
 */
export function groupChildrenForBoard(
  children: OutlineNode[],
  groupFieldId: string | null,
  schema: SchemaIndex,
): BoardColumn[] {
  if (groupFieldId === null) {
    return [{ ...group("__all__", "", null), nodes: [...children] }];
  }

  const fieldNode = schema.get(groupFieldId);
  const fieldLabel = textOr(fieldNode?.text, groupFieldId);
  const options = new Map<string, BoardColumn>();
  if (declaresOptionSet(fieldNode)) {
    for (const optionId of fieldNode?.children ?? []) {
      const value: PropValue = { t: "ref", v: optionId };
      options.set(
        propValueKey(value, schema),
        group(propValueKey(value, schema), propValueLabel(value, schema), value),
      );
    }
  }
  const others = new Map<string, BoardColumn>();
  const empty = group(EMPTY_GROUP_KEY, `No ${fieldLabel}`, null);

  for (const child of children) {
    // Display: first value wins. Drag clears all values then sets one.
    const [v] = child.props[groupFieldId] ?? [];
    if (v === undefined) {
      empty.nodes.push(child);
      continue;
    }
    const key = propValueKey(v, schema);
    let col = options.get(key) ?? others.get(key);
    if (!col) {
      col = group(key, propValueLabel(v, schema), v);
      others.set(key, col);
    }
    col.nodes.push(child);
  }

  const held = [...others.values()].toSorted((a, b) => a.label.localeCompare(b.label));
  return [...options.values(), ...held, empty];
}

/** How a grouped view shows its groups: the ones it folds, and whether it drops the empty ones. */
export interface GroupDisplay {
  readonly collapsed: readonly string[];
  readonly hideEmpty: boolean;
}

/** The groups a view shows, each folded when its key is in `collapsed`. */
export function shownGroups(columns: readonly BoardColumn[], display: GroupDisplay): BoardColumn[] {
  const folded = new Set(display.collapsed);
  return columns
    .filter((column) => !display.hideEmpty || column.nodes.length > 0)
    .map((column) => (folded.has(column.key) ? { ...column, collapsed: true } : column));
}

/** A group a row of a grouped view moves to by key: its value, null for "No <field>". */
interface GroupStep {
  readonly value: PropValue | null;
  /** The day a calendar opens at so the row stays drawn, when the move leaves the days shown. */
  readonly opens?: string;
}

/** The groups beside a row's own, where ⌘⇧← and ⌘⇧→ move it (DESIGN-UI.md → Groups). */
export interface GroupSteps {
  readonly before: GroupStep | null;
  readonly after: GroupStep | null;
}

/**
 * Where each row of the groups a view shows moves by key, by row id: the
 * unfolded groups before and after its own, none past either end. A folded
 * group draws no rows, so a row neither sits in one nor moves into one.
 */
export function groupSteps(columns: readonly BoardColumn[]): Map<string, GroupSteps> {
  const open = columns.filter((column) => !column.collapsed);
  const steps = new Map<string, GroupSteps>();
  open.forEach((column, at) => {
    const before = open[at - 1];
    const after = open[at + 1];
    const step: GroupSteps = {
      before: before === undefined ? null : { value: before.value },
      after: after === undefined ? null : { value: after.value },
    };
    for (const node of column.nodes) steps.set(node.id, step);
  });
  return steps;
}

/** A row's day by a date field: its first value's, when that is a day; else none. */
function dayOf(row: OutlineNode, fieldId: string): string | null {
  const [first] = row.props[fieldId] ?? [];
  if (first?.t !== "str") return null;
  const day = parseDay(first.v);
  return day === null ? null : formatDay(day);
}

/**
 * Group rows by the days a calendar shows (DESIGN-UI.md → Calendar): a
 * group per day of `shown`, in order, held or not, each holding the rows
 * whose date field's first value is that day, then "No <field>" for the
 * rows with none (an empty or unreadable date is none). A row dated on a
 * day not shown is in no group. With no field chosen, every row waits in
 * "No date".
 */
export function groupRowsByDay(
  rows: readonly OutlineNode[],
  fieldId: string | null,
  shown: readonly string[],
  schema: SchemaIndex,
): BoardColumn[] {
  const label = fieldId === null ? "date" : textOr(schema.get(fieldId)?.text, fieldId);
  const empty = group(EMPTY_GROUP_KEY, `No ${label}`, null);
  const byDay = new Map(
    shown.map((day) => {
      const value: PropValue = { t: "str", v: day };
      return [day, group(propValueKey(value, schema), longDay(day), value)] as const;
    }),
  );
  for (const row of rows) {
    const day = fieldId === null ? null : dayOf(row, fieldId);
    if (day === null) empty.nodes.push(row);
    else byDay.get(day)?.nodes.push(row);
  }
  return [...byDay.values(), empty];
}

/** The day `n` days from `day`. */
function shiftDay(day: string, n: number): string {
  const local = parseDay(day);
  return local === null ? day : formatDay(addDays(local, n));
}

/**
 * Where each row of a calendar's groups moves by key, by row id
 * (DESIGN-UI.md → Calendar): a day back or on, past the days shown too,
 * where the calendar opens at the row's new day (`opens`); a row with no
 * date, from the list beside the days, back onto the day it is open at.
 */
export function daySteps(
  columns: readonly BoardColumn[],
  shown: readonly string[],
  openDay: string,
): Map<string, GroupSteps> {
  const step = (day: string): GroupStep => ({
    value: { t: "str", v: day },
    ...(shown.includes(day) ? {} : { opens: day }),
  });
  const steps = new Map<string, GroupSteps>();
  for (const column of columns) {
    const day = column.value?.t === "str" ? column.value.v : null;
    const at: GroupSteps =
      day === null
        ? { before: step(openDay), after: null }
        : { before: step(shiftDay(day, -1)), after: step(shiftDay(day, 1)) };
    for (const node of column.nodes) steps.set(node.id, at);
  }
  return steps;
}

/** Flatten board columns to render-order node list (visible-instances); a folded one draws none. */
export function flattenBoardOrder(columns: BoardColumn[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const col of columns) {
    if (!col.collapsed) out.push(...col.nodes);
  }
  return out;
}
