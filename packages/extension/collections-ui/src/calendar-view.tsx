/**
 * A frame's rows on the days of a date field (DESIGN-UI.md → Calendar): a
 * day, a week or a month, the rows with no date in a list beside it. Its
 * groups are days, laid out by `frameRows` around the day the host keeps the
 * frame open at (`FrameSubject.day`), so the rows it draws are the rows the
 * walk reaches. A row moves to a day through the one group move
 * (`moveToGroup`), dragged here or by ⌘⇧←/→ in the selection's keys, and
 * its chip is drawn with the routines calendar's class list.
 */
import { memo, useCallback, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { CaretLeftIcon, CaretRightIcon, PlusIcon } from "@phosphor-icons/react";
import {
  calendarChipClass,
  calendarChipInk,
  DayNumber,
  longDay,
  MonthGrid,
  monthCellClass,
  sameMonth,
  stepAnchor,
  titleOf,
} from "@kb/calendar-kit";
import {
  browserHost,
  Button,
  cn,
  frameRows,
  type FrameSubject,
  IconButton,
  NodeRow,
  type OutlineNode,
  type PropValue,
  useGraphRead,
  useIsActive,
  useIsSelected,
  usePageGraph,
} from "@kb/ui-sdk";
import { CALENDAR_SPANS, type CalendarViewSpan, type ParamsOf } from "@kb/views";
import { CollectionCalendarView } from "@kb/collections";
import { AddRow } from "./add-row";
import { groupWhere } from "./group-where";

type CalendarParams = ParamsOf<typeof CollectionCalendarView>;

/** A day's group, or the undated rows', as `frameRows` lays them out. */
type BoardColumn = ReturnType<typeof frameRows>["columns"][number];

const SPAN_LABELS: Readonly<Record<CalendarViewSpan, string>> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

/** What every day and the list need to draw and take rows. */
interface CalendarFrame {
  readonly frame: FrameSubject;
  readonly params: CalendarParams;
  /** The date field rows move by; null when none is chosen, or the rows do not move. */
  readonly movesBy: string | null;
  readonly fieldId: string | null;
  readonly drag: {
    readonly start: (nodeId: string) => void;
    readonly end: () => void;
    readonly drop: (value: PropValue | null) => void;
  };
}

export function CalendarView({
  frame,
  params,
}: {
  readonly frame: FrameSubject;
  readonly params: CalendarParams;
}) {
  const { frameId, rowIds, isQuerySource } = frame;
  const graph = useGraphRead();
  const generation = usePageGraph((s) => s.index?.generation ?? 0);
  const nodes = graph.outline;
  const view = useMemo(() => ({ key: CollectionCalendarView, params }), [params]);
  const rows = useMemo(
    () => frameRows({ frameId, nodes, schema: graph.schema, view, rowIds, day: frame.day }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- generation gates the store map's identity
    [frameId, nodes, graph.schema, view, rowIds, frame.day, generation],
  );
  const fieldId = rows.groupFieldId;
  const movesBy = isQuerySource ? null : fieldId;

  const [dragged, setDragged] = useState<string | null>(null);
  const drop = useCallback(
    (value: PropValue | null) => {
      if (dragged === null || movesBy === null) return;
      void browserHost().writes.moveToGroup(dragged, movesBy, value);
      setDragged(null);
    },
    [dragged, movesBy],
  );
  const calendar: CalendarFrame = {
    frame,
    params,
    movesBy,
    fieldId,
    drag: { start: setDragged, end: () => setDragged(null), drop },
  };

  if (nodes.get(frameId) === undefined && rowIds === undefined) return null;
  const days = rows.columns.filter((column) => column.value !== null);
  const undated = rows.columns.find((column) => column.value === null);
  return (
    <div
      className="@container my-2"
      data-calendar-view="true"
      data-frame-id={frameId}
      data-span={params.span}
    >
      <CalendarHeader frame={frame} span={params.span} />
      <div className="grid items-start gap-3 @min-[480px]:grid-cols-[minmax(0,1fr)_minmax(9rem,14rem)]">
        <div className="min-w-0 rounded-md border-t border-border">
          {params.span === "month" ? (
            <MonthGrid>
              {days.map((column) => (
                <DayCell key={column.key} calendar={calendar} column={column} layout="month" />
              ))}
            </MonthGrid>
          ) : (
            <div
              className={cn(
                "grid border-r border-border",
                params.span === "week" && "@min-[480px]:grid-cols-7",
              )}
              data-calendar-layout={params.span}
            >
              {days.map((column) => (
                <DayCell
                  key={column.key}
                  calendar={calendar}
                  column={column}
                  layout={params.span}
                />
              ))}
            </div>
          )}
        </div>
        {undated === undefined ? null : <UndatedList calendar={calendar} column={undated} />}
      </div>
    </div>
  );
}

/** The header: a span back, today and on, the range's title, and the span, one pressed. */
function CalendarHeader({
  frame,
  span,
}: {
  readonly frame: FrameSubject;
  readonly span: CalendarViewSpan;
}) {
  const label = SPAN_LABELS[span].toLowerCase();
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1" data-calendar-header="true">
      <IconButton
        icon={CaretLeftIcon}
        label={`Previous ${label}`}
        onClick={() => frame.showDay(stepAnchor(span, frame.day, -1))}
      />
      <Button
        variant="ghost"
        className="text-label"
        onClick={() => frame.showDay(frame.today)}
        disabled={frame.day === frame.today}
      >
        Today
      </Button>
      <IconButton
        icon={CaretRightIcon}
        label={`Next ${label}`}
        onClick={() => frame.showDay(stepAnchor(span, frame.day, 1))}
      />
      <span className="px-1 text-ui font-medium text-foreground" data-calendar-title="true">
        {titleOf(span, frame.day)}
      </span>
      <div
        className="ml-auto flex h-7 items-center rounded-md border border-border p-0.5"
        role="group"
        aria-label="Span"
      >
        {CALENDAR_SPANS.map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={each === span}
            onClick={() => void browserHost().writes.setFrameSetting(frame.frameId, "span", each)}
            className={cn(
              "h-full rounded-sm px-2 text-label text-foreground",
              "outline-none focus-visible:ring-1 focus-visible:ring-ring",
              each === span ? "bg-accent shadow-edge" : "hover:bg-accent/60",
            )}
          >
            {SPAN_LABELS[each]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Where a row dragged over `value`'s group lands, while it is over it. */
function useDropTarget(
  calendar: CalendarFrame,
  value: PropValue | null,
): {
  readonly over: boolean;
  readonly handlers: {
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
  };
} {
  const [over, setOver] = useState(false);
  const takes = calendar.movesBy !== null;
  return {
    over,
    handlers: {
      onDragOver: (event) => {
        if (!takes) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event) => {
        event.preventDefault();
        setOver(false);
        calendar.drag.drop(value);
      },
    },
  };
}

/** A day: its number, "+ Add" while the pointer or focus is in it, and a chip per row. */
function DayCell({
  calendar,
  column,
  layout,
}: {
  readonly calendar: CalendarFrame;
  readonly column: BoardColumn;
  readonly layout: CalendarViewSpan;
}) {
  const { frame, params, fieldId } = calendar;
  const day = column.value?.t === "str" ? column.value.v : frame.day;
  const muted = layout === "month" && !sameMonth(day, frame.day);
  const { over, handlers } = useDropTarget(calendar, column.value);
  const named = longDay(day);
  return (
    <div
      data-calendar-day={day}
      className={cn(
        monthCellClass,
        "group/day",
        layout === "day" && "min-h-32",
        muted && "bg-muted/40",
        over && "bg-accent/60",
      )}
      {...handlers}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 text-label text-muted-foreground">
          {layout === "week" ? <span>{named.slice(0, 3)}</span> : null}
          <DayNumber day={day} today={frame.today} muted={muted} />
        </span>
        {fieldId === null ? null : (
          <IconButton
            icon={PlusIcon}
            label={`Add to ${named}`}
            data-add-row={frame.frameId}
            className="opacity-0 group-hover/day:opacity-100 group-focus-within/day:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            onClick={() => frame.addRow([...params.filters, ...groupWhere(fieldId, column.value)])}
          />
        )}
      </div>
      <Chips calendar={calendar} rows={column.nodes} />
    </div>
  );
}

/** The rows with no date: a list beside the days, which a dragged row leaves its date in. */
function UndatedList({
  calendar,
  column,
}: {
  readonly calendar: CalendarFrame;
  readonly column: BoardColumn;
}) {
  const { frame, params, fieldId } = calendar;
  const { over, handlers } = useDropTarget(calendar, null);
  return (
    <section
      aria-label={column.label}
      className={cn(
        "flex min-w-0 flex-col gap-px rounded-md border border-border p-1",
        over && "bg-accent/60",
      )}
      data-calendar-undated="true"
      {...handlers}
    >
      <h4 className="flex items-center justify-between px-1 text-label text-muted-foreground">
        {column.label}
        <span className="tabular-nums">{column.nodes.length}</span>
      </h4>
      {fieldId === null ? (
        <p className="px-1 py-0.5 text-meta text-muted-foreground">
          Choose a date field to place these rows on days.{" "}
          <button
            type="button"
            className="text-foreground underline underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => browserHost().setViewSettingsFrame(frame.frameId)}
          >
            Choose a date field
          </button>
        </p>
      ) : null}
      <Chips calendar={calendar} rows={column.nodes} />
      <AddRow frame={frame} filters={params.filters} label={`Add to ${column.label}`} />
    </section>
  );
}

function Chips({
  calendar,
  rows,
}: {
  readonly calendar: CalendarFrame;
  readonly rows: readonly OutlineNode[];
}): ReactNode {
  const { frame, movesBy, drag } = calendar;
  return rows.map((row) => (
    <CalendarChip
      key={row.id}
      row={row}
      instanceKey={frame.rowKey(row.id)}
      RowText={frame.RowText}
      draggable={movesBy !== null}
      onDragStart={drag.start}
      onDragEnd={drag.end}
    />
  ));
}

/**
 * A row on a day, as the routines calendar draws an instance (`calendarChipClass`):
 * the one node row (`NodeRow`), so it selects, focuses and edits as every row
 * does, at the calendar's density.
 */
const CalendarChip = memo(function CalendarChip({
  row,
  instanceKey,
  RowText,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  readonly row: OutlineNode;
  readonly instanceKey: string;
  readonly RowText: FrameSubject["RowText"];
  readonly draggable: boolean;
  readonly onDragStart: (nodeId: string) => void;
  readonly onDragEnd: () => void;
}) {
  const isActive = useIsActive(row.id, instanceKey);
  const isSelected = useIsSelected(row.id, instanceKey);
  return (
    <div
      data-calendar-chip={row.id}
      draggable={draggable && !isActive}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", row.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(row.id);
      }}
      onDragEnd={onDragEnd}
    >
      <NodeRow
        depth={0}
        nodeId={row.id}
        instanceKey={instanceKey}
        isSelected={isSelected}
        isActive={isActive}
        onRowClick={() => browserHost().selectNode(row.id, instanceKey)}
        bullet={null}
        className={cn(
          calendarChipClass,
          calendarChipInk,
          // The row's text at the chip's density: its label type, one line unless edited.
          "!min-h-0 touch-auto py-px [&>.node-content]:min-h-0 [&>.node-content]:px-0",
          "[&>.node-content_*]:min-h-0 [&_.kb-text-row]:text-label [&_.kb-text-row]:leading-tight",
          isActive ? "select-text" : "[&_.kb-text-row]:truncate",
        )}
        content={<RowText node={row} instanceKey={instanceKey} isActive={isActive} tags={[]} />}
      />
    </div>
  );
});
