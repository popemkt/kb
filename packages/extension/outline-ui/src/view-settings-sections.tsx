/**
 * The settings a frame's view reads, each drawn with the query builder's
 * slot (`ChoiceSlot`: a button that opens the one node picker over its
 * candidates). Which are drawn is the view's to say: a section is drawn when
 * the view's params declare its setting (`groupFieldId`, `dateFieldId`,
 * `hideEmpty`, `display`, `calc`, `pagesize`), as the frame's row walk groups, shows and pages by the same
 * declaration (`frameRows`). Each pick writes the frame's view node through
 * the page's writes, one setting at a time.
 */
import { useMemo } from "react";
import { fieldTypeOf } from "@kb/model";
import { CALCULATION_LABELS, calculationsFor, type Calculation } from "@kb/views";
import {
  CalendarBlankIcon,
  CalculatorIcon,
  ColumnsIcon,
  EyeSlashIcon,
  ListNumbersIcon,
  SquaresFourIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  browserHost,
  IconButton,
  PrefFieldRow,
  useFrameView,
  usePageGraph,
  type PickerCandidate,
  type TableColumnSpec,
} from "@kb/ui-sdk";
import { outlineNodes, useOutlineNode } from "./outline.store";
import { ChoiceSlot } from "./query-builder/slots";
import { frameColumns, frameFieldCandidates, pageSizeOptions } from "./view-settings-fields";

/** The group slot's choice that groups by nothing. Never a node id. */
const NO_GROUP = "\u0000none";

/** The fields of the frame's rows, read again whenever the graph changes. */
function useFieldCandidates(frameId: string): PickerCandidate[] {
  const generation = usePageGraph((s) => s.index?.generation ?? 0);
  return useMemo(
    () => frameFieldCandidates(frameId, outlineNodes(), browserHost().schema()),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- generation is the reactive invalidation key: the body reads the store imperatively, so generation drives recomputation
    [frameId, generation],
  );
}

/** Which field a board's columns are made of: one of the rows' fields, or none. */
function GroupSetting({ frameId, groupFieldId }: { frameId: string; groupFieldId: string | null }) {
  const fields = useFieldCandidates(frameId);
  const chosen = groupFieldId ?? NO_GROUP;
  const label =
    groupFieldId === null
      ? ""
      : (fields.find((f) => f.id === groupFieldId)?.label ??
        browserHost().schema().get(groupFieldId)?.text ??
        groupFieldId);
  return (
    <PrefFieldRow icon={SquaresFourIcon} label="group by">
      <ChoiceSlot
        name="group by"
        label={label}
        tone="value"
        candidates={[{ id: NO_GROUP, label: "None" }, ...fields]}
        chosen={chosen}
        placeholder="None"
        pickLabel="Group by field"
        onPick={(id) =>
          void browserHost().writes.setFrameSetting(
            frameId,
            "groupFieldId",
            id === NO_GROUP ? null : id,
          )
        }
      />
    </PrefFieldRow>
  );
}

/** The date field slot's choice that dates by nothing. Never a node id. */
const NO_DATE = "\u0000none";

/**
 * Which date field a calendar places its rows by (DESIGN-UI.md → Calendar):
 * one of the rows' fields of type date, or none.
 */
function DateFieldSetting({
  frameId,
  dateFieldId,
}: {
  frameId: string;
  dateFieldId: string | null;
}) {
  const schema = browserHost().schema();
  const fields = useFieldCandidates(frameId).filter(
    (field) => fieldTypeOf(schema.get(field.id)?.props, (id) => schema.get(id)) === "date",
  );
  const label =
    dateFieldId === null
      ? ""
      : (fields.find((f) => f.id === dateFieldId)?.label ??
        schema.get(dateFieldId)?.text ??
        dateFieldId);
  return (
    <PrefFieldRow icon={CalendarBlankIcon} label="date field">
      <ChoiceSlot
        name="date field"
        label={label}
        tone="value"
        candidates={[{ id: NO_DATE, label: "None" }, ...fields]}
        chosen={dateFieldId ?? NO_DATE}
        placeholder="None"
        pickLabel="Place rows by date field"
        onPick={(id) =>
          void browserHost().writes.setFrameSetting(
            frameId,
            "dateFieldId",
            id === NO_DATE ? null : id,
          )
        }
      />
    </PrefFieldRow>
  );
}

/**
 * The fields a frame's rows are shown with, in order: each removable, and
 * one more added from the rows' fields. A view node that names none shows
 * the fields the rows' tags template; removing or adding one names the rest
 * explicitly, and "tags' fields" goes back to naming none. The last field
 * shown is not removable: naming none is what shows the tags' fields, so
 * removing it would bring them back rather than leave no field.
 */
function ColumnsSetting({ frameId, display }: { frameId: string; display: readonly string[] }) {
  const fields = useFieldCandidates(frameId);
  const generation = usePageGraph((s) => s.index?.generation ?? 0);
  const columns: TableColumnSpec[] = useMemo(
    () => frameColumns(frameId, outlineNodes(), browserHost().schema(), { display: [...display] }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- generation is the reactive invalidation key, as in useFieldCandidates
    [frameId, display, generation],
  );
  const shown = columns.map((c) => c.fieldId);
  // An edit rewrites the names the view node holds, or, holding none, the
  // fields shown: a name the table does not draw now (its node hides it)
  // is kept, never dropped by a remove or an add beside it.
  const named = display.length > 0 ? [...display] : shown;
  const write = (next: string[]) =>
    void browserHost().writes.setFrameSetting(frameId, "display", next);
  return (
    <PrefFieldRow icon={ColumnsIcon} label="fields">
      <div className="flex flex-wrap items-center gap-1" data-view-columns={frameId}>
        {columns.map((column) => (
          <span
            key={column.fieldId}
            className="inline-flex items-center gap-0.5 rounded-sm bg-foreground/[0.06] py-0.5 pr-0.5 pl-1.5 text-meta text-foreground/75"
            data-view-column={column.fieldId}
          >
            {column.label}
            {/* The last field shown stays: a view naming none shows its tags' fields again. */}
            {columns.length > 1 ? (
              <IconButton
                icon={XIcon}
                label={`Remove field ${column.label}`}
                onClick={() => write(named.filter((id) => id !== column.fieldId))}
              />
            ) : null}
          </span>
        ))}
        <ChoiceSlot
          name="add field"
          label=""
          tone="value"
          candidates={fields.filter((f) => !shown.includes(f.id))}
          placeholder="+ field"
          pickLabel="Show field"
          onPick={(id) => write([...named, id])}
        />
        {display.length > 0 ? (
          <button
            type="button"
            className="rounded-sm px-1 text-meta text-foreground/40 hover:text-foreground/70"
            title="Show the fields the rows' tags declare"
            onClick={() => write([])}
          >
            tags' fields
          </button>
        ) : null}
      </div>
    </PrefFieldRow>
  );
}

/** How many rows a page shows before "show more". */
function PageSizeSetting({ frameId, pagesize }: { frameId: string; pagesize: number }) {
  const candidates = pageSizeOptions(pagesize).map((size) => ({
    id: String(size),
    label: `${size} rows`,
  }));
  return (
    <PrefFieldRow icon={ListNumbersIcon} label="page size">
      <ChoiceSlot
        name="page size"
        label={`${pagesize} rows`}
        tone="value"
        candidates={candidates}
        chosen={String(pagesize)}
        pickLabel="Rows per page"
        onPick={(id) => void browserHost().writes.setFrameSetting(frameId, "pagesize", Number(id))}
      />
    </PrefFieldRow>
  );
}

/** Whether a grouped view leaves out the groups no row falls in. */
function HideEmptySetting({ frameId, hideEmpty }: { frameId: string; hideEmpty: boolean }) {
  return (
    <PrefFieldRow icon={EyeSlashIcon} label="empty groups">
      <ChoiceSlot
        name="empty groups"
        label={hideEmpty ? "Hide" : "Show"}
        tone="value"
        candidates={EMPTY_GROUP_CHOICES}
        chosen={hideEmpty ? "hide" : "show"}
        pickLabel="Empty groups"
        onPick={(id) =>
          void browserHost().writes.setFrameSetting(frameId, "hideEmpty", id === "hide")
        }
      />
    </PrefFieldRow>
  );
}

/** The calculation slot's choice that calculates nothing. Never a calculation. */
const NO_CALC = "\u0000none";

/**
 * Each field column's calculation (DESIGN-UI.md → Calculations): a slot over
 * the calculations its field's type offers, and None.
 */
function CalcSetting({
  frameId,
  calc,
  display,
}: {
  frameId: string;
  calc: Readonly<Record<string, Calculation>>;
  display: readonly string[];
}) {
  const generation = usePageGraph((s) => s.index?.generation ?? 0);
  const columns: TableColumnSpec[] = useMemo(
    () => frameColumns(frameId, outlineNodes(), browserHost().schema(), { display: [...display] }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- generation is the reactive invalidation key, as in useFieldCandidates
    [frameId, display, generation],
  );
  const schema = browserHost().schema();
  // A pick is one of the column's offered calculations, or None.
  const write = (fieldId: string, offered: readonly Calculation[], choice: string) => {
    const { [fieldId]: _dropped, ...rest } = calc;
    const picked = offered.find((offer) => offer === choice);
    const next = picked === undefined ? rest : { ...rest, [fieldId]: picked };
    void browserHost().writes.setFrameSetting(frameId, "calc", next);
  };
  return (
    <PrefFieldRow icon={CalculatorIcon} label="calculations">
      <div className="flex flex-col gap-0.5" data-view-calc={frameId}>
        {columns.map((column) => {
          const offered = calculationsFor(
            fieldTypeOf(schema.get(column.fieldId)?.props, (id) => schema.get(id)),
          );
          const chosen = calc[column.fieldId];
          return (
            <span key={column.fieldId} className="flex items-center gap-1 text-meta">
              <span className="text-foreground/55">{column.label}</span>
              <ChoiceSlot
                name={`${column.label} calculation`}
                label={chosen === undefined ? "" : CALCULATION_LABELS[chosen]}
                tone="value"
                candidates={[
                  { id: NO_CALC, label: "None" },
                  ...offered.map((id) => ({ id, label: CALCULATION_LABELS[id] })),
                ]}
                chosen={chosen ?? NO_CALC}
                placeholder="None"
                pickLabel={`Calculate ${column.label}`}
                onPick={(id) => write(column.fieldId, offered, id)}
              />
            </span>
          );
        })}
      </div>
    </PrefFieldRow>
  );
}

const EMPTY_GROUP_CHOICES = [
  { id: "show", label: "Show" },
  { id: "hide", label: "Hide" },
];

/** The sections the frame's view declares a setting for, in the order they are reached for. */
export function ViewSettingsSections({ frameId }: { frameId: string }) {
  const view = useFrameView(useOutlineNode(frameId));
  if (view === null) return null;
  const { params } = view;
  const sections = [
    params.groupFieldId !== undefined ? (
      <GroupSetting key="group" frameId={frameId} groupFieldId={params.groupFieldId} />
    ) : null,
    params.dateFieldId !== undefined ? (
      <DateFieldSetting key="dateField" frameId={frameId} dateFieldId={params.dateFieldId} />
    ) : null,
    params.hideEmpty !== undefined ? (
      <HideEmptySetting key="hideEmpty" frameId={frameId} hideEmpty={params.hideEmpty} />
    ) : null,
    params.display !== undefined ? (
      <ColumnsSetting key="display" frameId={frameId} display={params.display} />
    ) : null,
    params.calc !== undefined ? (
      <CalcSetting key="calc" frameId={frameId} calc={params.calc} display={params.display ?? []} />
    ) : null,
    params.pagesize !== undefined ? (
      <PageSizeSetting key="pagesize" frameId={frameId} pagesize={params.pagesize} />
    ) : null,
  ].filter((section) => section !== null);
  if (sections.length === 0) return null;
  return (
    <div
      className="mb-1 border-b border-foreground/[0.06] pb-1"
      data-view-settings-sections={frameId}
      data-view={view.key.id}
    >
      {sections}
    </div>
  );
}
