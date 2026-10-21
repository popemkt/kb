/**
 * The settings a frame's view reads, each drawn with the query builder's
 * slot (`ChoiceSlot`: a button that opens the one node picker over its
 * candidates). Which are drawn is the view's to say: a section is drawn when
 * the view's params declare its setting (`groupFieldId`, `display`,
 * `pagesize`), as the frame's row walk groups, shows and pages by the same
 * declaration (`frameRows`). Each pick writes the frame's view node through
 * the page's writes, one setting at a time.
 */
import { useMemo } from "react";
import { ColumnsIcon, ListNumbersIcon, SquaresFourIcon, XIcon } from "@phosphor-icons/react";
import {
  browserHost,
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
          void browserHost().writes.setViewGroup(frameId, id === NO_GROUP ? null : id)
        }
      />
    </PrefFieldRow>
  );
}

/**
 * The fields a frame's rows are shown with, in order: each removable, and
 * one more added from the rows' fields. A view node that names none shows
 * the fields the rows' tags template; removing or adding one names the rest
 * explicitly, and "tags' fields" goes back to naming none.
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
  const write = (next: string[]) => void browserHost().writes.setViewDisplay(frameId, next);
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
            <button
              type="button"
              className="flex h-4 w-4 items-center justify-center rounded-xs text-foreground/35 hover:text-foreground/70"
              aria-label={`Remove field ${column.label}`}
              onClick={() => write(shown.filter((id) => id !== column.fieldId))}
            >
              <XIcon size={10} weight="bold" />
            </button>
          </span>
        ))}
        <ChoiceSlot
          name="add field"
          label=""
          tone="value"
          candidates={fields.filter((f) => !shown.includes(f.id))}
          placeholder="+ field"
          pickLabel="Show field"
          onPick={(id) => write([...shown, id])}
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
        onPick={(id) => void browserHost().writes.setViewPagesize(frameId, Number(id))}
      />
    </PrefFieldRow>
  );
}

/** The sections the frame's view declares a setting for, in the order they are reached for. */
export function ViewSettingsSections({ frameId }: { frameId: string }) {
  const view = useFrameView(useOutlineNode(frameId));
  if (view === null) return null;
  const { params } = view;
  const sections = [
    params.groupFieldId !== undefined ? (
      <GroupSetting key="group" frameId={frameId} groupFieldId={params.groupFieldId} />
    ) : null,
    params.display !== undefined ? (
      <ColumnsSetting key="display" frameId={frameId} display={params.display} />
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
