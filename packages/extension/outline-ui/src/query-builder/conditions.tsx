/**
 * The Conditions tab: a person's tree drawn as sentences of slots, ANDed at
 * the top level, groups as boxes of their children. Every edit is a new
 * tree handed to `edit`, which writes it; this draws and decides nothing
 * about storage.
 *
 * Keyboard (docs/brainstorms/2026-10-20-query-builder → Interaction): Tab
 * and Shift-Tab move between slots (each is a button), Enter opens a slot,
 * ⌘↵ adds a condition below the one the keyboard is in, and ⌫ on a row that
 * says nothing yet removes it.
 */
import { useMemo, useState, type ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react";
import type { WireNode } from "@kb/contracts";
import { declaresOptionSet } from "@kb/model";
import type { ConditionEdge, ConditionRow } from "@kb/query";
import {
  cn,
  formatPropValue,
  hasText,
  type GraphRead,
  isSysPrefixed,
  nodeCandidates,
  OptionChip,
  optionColorOf,
  type PickerCandidate,
  type PropValue,
  resolveFieldTypeById,
  SYSTEM_IDS,
  TagChip,
  tagColorOf,
  tagPalette,
} from "@kb/ui-sdk";
import { nodesOfKind } from "../outline-steps";
import { valueKindOf } from "../value-kind";
import {
  ATTRIBUTE_LABELS,
  ATTRIBUTES,
  BLANK,
  childrenOf,
  insertAt,
  isComplete,
  isFieldRow,
  type FieldRow,
  isGroupCondition,
  newGroup,
  OPERATORS,
  operandKindOf,
  operatorLabel,
  operatorOf,
  regroup,
  removeAt,
  replaceAt,
  rowForSubject,
  rowValues,
  subjectOf,
  tagsOf,
  withDays,
  withExactCase,
  withOperator,
  withTarget,
  withValues,
  withVia,
  type BlankRow,
  type BuilderCondition,
  type BuilderTree,
  type Group,
  type GroupKind,
  type Path,
  type Subject,
} from "./model";
import { neighbourSlot, slotClass } from "./slot-dom";
import { ChoiceSlot, ValuesSlot, type ValueEditing } from "./slots";

/** What every row of one builder reads: the graph, and the tree it edits. */
interface Builder {
  readonly read: GraphRead;
  readonly wireNodes: readonly WireNode[];
  readonly tree: BuilderTree;
  readonly edit: (next: BuilderTree) => void;
  /** The row the last gesture made, whose first slot opens as it is drawn; the next gesture clears it. */
  readonly opening: string | null;
  readonly open: (path: Path) => void;
}

const key = (path: Path) => path.join(".");

const GROUP_LABELS: Readonly<Record<GroupKind, string>> = {
  "any-of": "any of",
  "all-of": "all of",
  "none-of": "none of",
};
const GROUP_KINDS: readonly GroupKind[] = ["any-of", "all-of", "none-of"];

const ATTRIBUTE_ID = "\u0000attr:";

/** A subject as a picker candidate id: a field's own id, or an attribute's. */
const subjectId = (subject: Subject): string =>
  subject.t === "field" ? subject.field : `${ATTRIBUTE_ID}${subject.attr}`;

function subjectFromId(id: string): Subject {
  if (!id.startsWith(ATTRIBUTE_ID)) return { t: "field", field: id };
  const attr = ATTRIBUTES.find((a) => `${ATTRIBUTE_ID}${a}` === id);
  return attr === undefined ? { t: "field", field: id } : { t: "attr", attr };
}

/**
 * What a row may be about, in the order a person reaches for it: the fields
 * of the tags the query already names (`sys.f.fields`), then the
 * vocabulary's own sentences, then every other field. Fields are the
 * add-field step's candidates (`nodesOfKind`); a `sys.*` field and the type
 * field (that is "has tag") are not offered.
 */
function subjectCandidates(builder: Builder): PickerCandidate[] {
  const { schema } = builder.read;
  const fields = nodesOfKind(builder.wireNodes, SYSTEM_IDS.field).filter(
    (f) => !isSysPrefixed(f.id),
  );
  const templated = new Set(
    tagsOf(builder.tree).flatMap((tag) =>
      (schema.get(tag)?.props[SYSTEM_IDS.fieldsField] ?? []).flatMap((v) =>
        v.t === "ref" ? [v.v] : [],
      ),
    ),
  );
  const attributes = ATTRIBUTES.map((attr) => ({
    id: `${ATTRIBUTE_ID}${attr}`,
    label: ATTRIBUTE_LABELS[attr],
  }));
  return [
    ...fields.filter((f) => templated.has(f.id)),
    ...attributes,
    ...fields.filter((f) => !templated.has(f.id)),
  ];
}

function labelOf(read: GraphRead, id: string): string {
  return [read.schema.get(id)?.text, read.outline.get(id)?.text].find(hasText) ?? id;
}

/** The keys a row takes: ⌘↵ adds a condition below it, ⌫ on a row that says nothing removes it. */
function rowKeys(builder: Builder, path: Path, says: boolean) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      const below = [...path.slice(0, -1), (path.at(-1) ?? 0) + 1];
      builder.edit(insertAt(builder.tree, below, BLANK));
      builder.open(below);
      return;
    }
    // A key goes to what has the keyboard: the slot it is on.
    const target = e.currentTarget.ownerDocument.activeElement;
    if (e.key === "Backspace" && !says && target?.tagName === "BUTTON") {
      e.preventDefault();
      e.stopPropagation();
      const previous = neighbourSlot(target, -1);
      builder.edit(removeAt(builder.tree, path));
      previous?.focus();
    }
  };
}

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-foreground/25",
        "outline-none hover:text-foreground/60 focus-visible:ring-2 focus-visible:ring-primary/60",
      )}
      aria-label={label}
      title={label}
      data-qb-slot="remove"
      onClick={onRemove}
    >
      <XIcon size={11} weight="bold" aria-hidden />
    </button>
  );
}

/** The values a field row holds, drawn as the field draws them: option chips, node labels, text. */
function ValuesShown({
  read,
  fieldId,
  values,
}: {
  read: GraphRead;
  fieldId: string;
  values: readonly PropValue[];
}) {
  const field = read.schema.get(fieldId);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {values.map((value) => {
        const option =
          value.t === "ref" && declaresOptionSet(field) ? read.schema.get(value.v) : undefined;
        return option === undefined ? (
          <span key={`${value.t}:${String(value.v)}`}>{valueText(read, value)}</span>
        ) : (
          <OptionChip
            key={option.id}
            id={option.id}
            label={option.text || option.id}
            color={optionColorOf(option, field)}
          />
        );
      })}
    </span>
  );
}

function valueText(read: GraphRead, value: PropValue): string {
  if (value.t === "bool") return value.v ? "checked" : "not checked";
  return formatPropValue(value, read.schema) || String(value.v);
}

const valuesLabel = (read: GraphRead, values: readonly PropValue[]) =>
  values.map((v) => valueText(read, v)).join(", ");

/** How a field's values are edited: picked, typed, or toggled, by the field's own kind. */
function editingOf(read: GraphRead, fieldId: string): ValueEditing {
  const type = resolveFieldTypeById(fieldId, read.schema);
  const kind = valueKindOf(type, fieldId, read.schema.get(fieldId));
  if (kind === "ref" || kind === "option") return { t: "picked" };
  if (kind === "checkbox") return { t: "toggle" };
  return { t: "typed", type };
}

const daysOf = (values: readonly PropValue[]): number | null => {
  const [first] = values;
  return first?.t === "num" ? first.v : null;
};

/** The time zone the page's engine reads "today" in: the browser's. */
const timeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The slots of a row about a field: the operator, then what it compares with. */
function FieldSlots({ builder, row, path }: { builder: Builder; row: FieldRow; path: Path }) {
  const { read } = builder;
  const type = resolveFieldTypeById(row.field, read.schema);
  const kind = operandKindOf(type);
  const op = operatorOf(row) ?? "is";
  const set = (next: ConditionRow) => builder.edit(replaceAt(builder.tree, path, next));
  const opCandidates = OPERATORS[kind].map((o) => ({ id: o, label: operatorLabel(o, kind) }));
  const name = labelOf(read, row.field);
  return (
    <>
      <ChoiceSlot
        name="operator"
        label={operatorLabel(op, kind)}
        tone="operator"
        candidates={opCandidates}
        chosen={op}
        pickLabel={`Pick how ${name} compares`}
        onPick={(id) => set(withOperator(row, row.field, id))}
      />
      {(row.kind === "field-is" ||
        row.kind === "field-is-not" ||
        row.kind === "field-compares") && (
        <ValuesSlot
          name={row.kind === "field-compares" ? "value" : "values"}
          label={valuesLabel(read, rowValues(row))}
          fieldId={row.field}
          context={read}
          values={rowValues(row)}
          editing={
            row.kind === "field-compares" ? { t: "typed", type } : editingOf(read, row.field)
          }
          onValues={(values) => set(withValues(row, values))}
          placeholder="value"
        >
          <ValuesShown read={read} fieldId={row.field} values={rowValues(row)} />
        </ValuesSlot>
      )}
      {row.kind === "field-contains" && <TextSlots builder={builder} row={row} path={path} />}
      {row.kind === "date-within" && (
        <DaysSlot builder={builder} row={row} path={path} fieldId={row.field} civil />
      )}
    </>
  );
}

/** The text a row matches, and whether case counts. */
function TextSlots({
  builder,
  row,
  path,
}: {
  builder: Builder;
  row: Extract<ConditionRow, { kind: "text-contains" | "field-contains" }>;
  path: Path;
}) {
  const set = (next: ConditionRow) => builder.edit(replaceAt(builder.tree, path, next));
  const values: PropValue[] = row.text === "" ? [] : [{ t: "str", v: row.text }];
  return (
    <>
      <ValuesSlot
        name="text"
        label={row.text}
        fieldId={row.kind === "field-contains" ? row.field : ""}
        context={builder.read}
        values={values}
        editing={{ t: "typed", type: "text" }}
        onValues={(next) => {
          const [first] = next;
          set({ ...row, text: first?.t === "str" ? first.v : "" });
        }}
        placeholder="text"
      />
      <button
        type="button"
        className={cn(
          slotClass("operator"),
          "font-mono",
          row.exactCase && "border-primary/40 bg-primary/10 text-foreground/80",
        )}
        aria-label="exact case"
        aria-pressed={row.exactCase}
        title={row.exactCase ? "Case counts" : "Case does not count"}
        data-qb-slot="case"
        onClick={() => set(withExactCase(row, !row.exactCase))}
      >
        Aa
      </button>
    </>
  );
}

/** How many days a window spans, and in which calendar it is read. */
function DaysSlot({
  builder,
  row,
  path,
  fieldId,
  civil,
}: {
  builder: Builder;
  row: Extract<ConditionRow, { kind: "date-within" | "instant-within" }>;
  path: Path;
  fieldId: string;
  /** A civil date (a date field), read in the person's zone; else an instant, in UTC. */
  civil: boolean;
}) {
  const set = (next: ConditionRow) => builder.edit(replaceAt(builder.tree, path, next));
  const values: PropValue[] = [{ t: "num", v: row.days }];
  const reading = civil
    ? `civil dates, from today in ${timeZone()}, both ends included`
    : "instants, ending now";
  return (
    <>
      <ValuesSlot
        name="days"
        label={`${row.days} days`}
        fieldId={fieldId}
        context={builder.read}
        values={values}
        editing={{ t: "typed", type: "number" }}
        onValues={(next) => {
          const days = daysOf(next);
          if (days !== null) set(withDays(row, days));
        }}
      >
        {row.days} {row.days === 1 ? "day" : "days"}
      </ValuesSlot>
      <span className="text-caption text-foreground/35" title={reading}>
        {civil ? timeZone() : "UTC"}
      </span>
    </>
  );
}

const VIA_CHILD = "\u0000via:child";
const VIA_MENTIONS = "\u0000via:mentions";

function viaId(via: ConditionEdge): string {
  if (via.t === "child") return VIA_CHILD;
  if (via.t === "mentions") return VIA_MENTIONS;
  return via.field;
}

function viaOf(id: string): ConditionEdge {
  if (id === VIA_CHILD) return { t: "child" };
  if (id === VIA_MENTIONS) return { t: "mentions" };
  return { t: "field", field: id };
}

/** The slots of a row about a node: the node, and for under/above, the edge walked. */
function NodeSlots({
  builder,
  row,
  path,
}: {
  builder: Builder;
  row: Extract<ConditionRow, { node: string }>;
  path: Path;
}) {
  const { read } = builder;
  const set = (next: ConditionRow) => builder.edit(replaceAt(builder.tree, path, next));
  const candidates = useMemo(() => nodeCandidates(read.outline), [read.outline]);
  return (
    <>
      <ChoiceSlot
        name="node"
        label={row.node === "" ? "" : labelOf(read, row.node)}
        tone="value"
        candidates={candidates}
        chosen={row.node}
        pickLabel="Pick a node"
        placeholder="node"
        onPick={(id) => set(withTarget(row, id))}
      />
      {(row.kind === "under" || row.kind === "above") && (
        <ChoiceSlot
          name="via"
          label={viaLabel(read, row.via)}
          tone="operator"
          candidates={viaCandidates(builder)}
          chosen={viaId(row.via)}
          pickLabel="Pick what to walk"
          onPick={(id) => set(withVia(row, viaOf(id)))}
        />
      )}
      {(row.kind === "under" || row.kind === "above") && row.maxHops !== undefined && (
        <span className="text-meta text-foreground/50">
          within {row.maxHops} {row.maxHops === 1 ? "level" : "levels"}
        </span>
      )}
    </>
  );
}

function viaLabel(read: GraphRead, via: ConditionEdge): string {
  if (via.t === "child") return "via the outline";
  if (via.t === "mentions") return "via references";
  return `via ${labelOf(read, via.field)}`;
}

/** What `under` and `above` may walk: the outline, references, or any ref field. */
function viaCandidates(builder: Builder): PickerCandidate[] {
  const { schema } = builder.read;
  const refFields = nodesOfKind(builder.wireNodes, SYSTEM_IDS.field)
    .filter((f) => !isSysPrefixed(f.id) && resolveFieldTypeById(f.id, schema) === "ref")
    .map((f) => ({ id: f.id, label: `via ${f.label}` }));
  return [
    { id: VIA_CHILD, label: "via the outline" },
    { id: VIA_MENTIONS, label: "via references" },
    ...refFields,
  ];
}

/** The tag a tag row names, picked from the add-tag step's candidates. */
function TagSlot({
  builder,
  row,
  path,
}: {
  builder: Builder;
  row: Extract<ConditionRow, { kind: "has-tag" | "lacks-tag" }>;
  path: Path;
}) {
  const { read, wireNodes } = builder;
  const candidates = useMemo(() => nodesOfKind(wireNodes, SYSTEM_IDS.tag), [wireNodes]);
  const name = row.tag === "" ? "" : labelOf(read, row.tag);
  return (
    <ChoiceSlot
      name="tag"
      label={name}
      tone="value"
      candidates={candidates}
      chosen={row.tag}
      pickLabel="Pick a tag"
      placeholder="tag"
      onPick={(id) => builder.edit(replaceAt(builder.tree, path, withTarget(row, id)))}
    >
      <TagChip tag={{ id: row.tag, name, color: tagColorOf(row.tag, tagPalette(wireNodes)) }} />
    </ChoiceSlot>
  );
}

/** What follows a row's subject: its operator and values, by what the row is. */
function RowSlots({ builder, row, path }: { builder: Builder; row: ConditionRow; path: Path }) {
  if (isFieldRow(row)) return <FieldSlots builder={builder} row={row} path={path} />;
  switch (row.kind) {
    case "has-tag":
    case "lacks-tag":
      return <TagSlot builder={builder} row={row} path={path} />;
    case "text-contains":
      return (
        <>
          <span className="text-meta text-foreground/50">contains</span>
          <TextSlots builder={builder} row={row} path={path} />
        </>
      );
    case "instant-within":
      return (
        <>
          <span className="text-meta text-foreground/50">in the last</span>
          <DaysSlot builder={builder} row={row} path={path} fieldId="" civil={false} />
        </>
      );
    case "under":
    case "above":
    case "child-of":
    case "links-to":
    case "linked-from":
      return <NodeSlots builder={builder} row={row} path={path} />;
    case "has-children":
      return null;
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

/** One condition: its subject, then what it says of it, then its remove. */
function ConditionLine({
  builder,
  row,
  path,
}: {
  builder: Builder;
  row: ConditionRow | BlankRow;
  path: Path;
}) {
  const { read } = builder;
  const subject = subjectOf(row);
  const says = row.kind !== "blank" && isComplete(row);
  const subjectLabel =
    subject === null
      ? ""
      : subject.t === "field"
        ? labelOf(read, subject.field)
        : ATTRIBUTE_LABELS[subject.attr];
  return (
    <div
      className="flex min-h-7 flex-wrap items-center gap-1"
      role="group"
      aria-label={subject === null ? "new condition" : `condition: ${subjectLabel}`}
      data-qb-row={key(path)}
      onKeyDown={rowKeys(builder, path, says)}
    >
      <ChoiceSlot
        name={subject?.t === "field" ? "field" : "condition"}
        label={subjectLabel}
        tone="subject"
        candidates={subjectCandidates(builder)}
        chosen={subject === null ? undefined : subjectId(subject)}
        pickLabel="Pick a field or a condition"
        placeholder="field or condition"
        autoOpen={builder.opening === key(path)}
        onPick={(id) =>
          builder.edit(replaceAt(builder.tree, path, rowForSubject(subjectFromId(id), row)))
        }
      />
      {row.kind !== "blank" && <RowSlots builder={builder} row={row} path={path} />}
      <RemoveButton
        label="remove condition"
        onRemove={() => builder.edit(removeAt(builder.tree, path))}
      />
    </div>
  );
}

function AddButtons({ builder, list, size }: { builder: Builder; list: Path; size: number }) {
  const at = [...list, size];
  const add = (condition: BuilderCondition, open: Path) => {
    builder.edit(insertAt(builder.tree, at, condition));
    builder.open(open);
  };
  const button = cn(
    "rounded-sm px-1 text-meta text-foreground/40 outline-none",
    "hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-primary/60",
  );
  return (
    <div className="mt-1 flex gap-3.5">
      <button
        type="button"
        className={button}
        data-qb-slot="add-condition"
        onClick={() => add(BLANK, at)}
      >
        + condition
      </button>
      <button
        type="button"
        className={button}
        data-qb-slot="add-group"
        onClick={() => add(newGroup("any-of"), [...at, 0])}
      >
        + group
      </button>
    </div>
  );
}

/** A group: its kind, its children, and a way to add one more. */
function GroupBox({ builder, group, path }: { builder: Builder; group: Group; path: Path }) {
  const children = childrenOf(group);
  return (
    <div
      className="my-1 rounded-md border border-dashed border-foreground/15 px-2 pt-1 pb-1.5"
      role="group"
      aria-label={GROUP_LABELS[group.kind]}
      data-qb-row={key(path)}
      data-qb-group={group.kind}
    >
      <div className="mb-0.5 flex items-center gap-1">
        <ChoiceSlot
          name="group"
          label={GROUP_LABELS[group.kind]}
          tone="operator"
          candidates={GROUP_KINDS.map((kind) => ({
            id: kind,
            label: GROUP_LABELS[kind],
          }))}
          chosen={group.kind}
          pickLabel="Pick how the group combines"
          onPick={(kind) => builder.edit(replaceAt(builder.tree, path, regroup(group, kind)))}
        />
        <RemoveButton
          label="remove group"
          onRemove={() => builder.edit(removeAt(builder.tree, path))}
        />
      </div>
      <ConditionList builder={builder} list={children} path={path} />
      <AddButtons builder={builder} list={path} size={children.length} />
    </div>
  );
}

function ConditionList({
  builder,
  list,
  path,
}: {
  builder: Builder;
  list: readonly BuilderCondition[];
  path: Path;
}): ReactNode {
  return list.map((c, i) => {
    const at = [...path, i];
    return isGroupCondition(c) ? (
      <GroupBox key={key(at)} builder={builder} group={c} path={at} />
    ) : (
      <ConditionLine key={key(at)} builder={builder} row={c} path={at} />
    );
  });
}

/** The Conditions tab over `tree`, every edit handed to `edit`. */
export function ConditionsEditor({
  read,
  wireNodes,
  tree,
  edit,
}: {
  read: GraphRead;
  wireNodes: readonly WireNode[];
  tree: BuilderTree;
  edit: (next: BuilderTree) => void;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const builder: Builder = {
    read,
    wireNodes,
    tree,
    // A gesture that makes a row opens it after this; any other is past it.
    edit: (next) => {
      setOpening(null);
      edit(next);
    },
    opening,
    open: (path) => setOpening(key(path)),
  };
  return (
    <div data-qb-conditions="true">
      {tree.length === 0 && (
        <p className="py-0.5 text-meta text-foreground/40">No conditions: every node matches.</p>
      )}
      <ConditionList builder={builder} list={tree} path={[]} />
      <AddButtons builder={builder} list={[]} size={tree.length} />
    </div>
  );
}
