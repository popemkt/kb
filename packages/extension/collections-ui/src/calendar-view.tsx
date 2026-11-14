/**
 * A frame's rows on the days of a date field (DESIGN-UI.md → Calendar): a
 * day, a week or a month, the rows with no date in a list beside it. Its
 * groups are days, laid out by `frameRows` around the day the host keeps the
 * frame open at (`FrameSubject.day`), so the rows it draws are the rows the
 * walk reaches. A row moves to a day through the one group move
 * (`moveToGroup`), dragged here or by ⌘⇧←/→ in the selection's keys, and
 * its chip is drawn with the routines calendar's class list.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
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
  useNarrowViewport,
  usePageGraph,
} from "@kb/ui-sdk";
import { CALENDAR_SPANS, type CalendarViewSpan, type ParamsOf } from "@kb/views";
import { CollectionCalendarView } from "@kb/collections";
import { AddRow } from "./add-row";
import { useViewBreakout } from "./breakout";
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
  const drawn = nodes.get(frameId) !== undefined || rowIds !== undefined;
  // A calendar wants the room a board does: on a centered page it spans the scroll region.
  const {
    attach,
    className: breakoutClass,
    data: breakoutData,
  } = useViewBreakout({
    wants: true,
    widthPref: undefined,
    mounted: drawn,
  });
  // On a phone a month is too narrow for chips: its days carry dots, and the open day's rows list under them.
  const narrow = useNarrowViewport();

  if (!drawn) return null;
  const days = rows.columns.filter((column) => column.value !== null);
  const undated = rows.columns.find((column) => column.value === null);
  return (
    <div
      ref={attach}
      className={cn("@container my-2", breakoutClass)}
      data-calendar-view="true"
      data-frame-id={frameId}
      data-span={params.span}
      data-breakout={breakoutData}
    >
      <CalendarHeader frame={frame} span={params.span} />
      <div className="grid items-start gap-3 @min-[900px]:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)]">
        <div className="min-w-0 rounded-md border-t border-border">
          {params.span !== "month" ? (
            <DayColumns calendar={calendar} days={days} span={params.span} />
          ) : narrow ? (
            <PhoneMonth calendar={calendar} days={days} />
          ) : (
            <MonthGrid>
              {days.map((column) => (
                <MonthCell key={column.key} calendar={calendar} column={column} />
              ))}
            </MonthGrid>
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

/** The day a column of a calendar's groups holds; the open day for the list's. */
const dayIn = (column: BoardColumn, frame: FrameSubject): string =>
  column.value?.t === "str" ? column.value.v : frame.day;

/** A day's "+ Add", a row holding that day; none while no date field is chosen. */
function AddToDay({
  calendar,
  column,
}: {
  readonly calendar: CalendarFrame;
  readonly column: BoardColumn;
}) {
  const { frame, params, fieldId } = calendar;
  if (fieldId === null) return null;
  return (
    <AddRow
      frame={frame}
      filters={params.filters}
      where={groupWhere(fieldId, column.value)}
      label={`Add to ${longDay(dayIn(column, frame))}`}
    />
  );
}

/**
 * A day of a month: its number, "+" while the pointer or focus is in it,
 * and a chip per row, two lines each. Every cell is one height, so a busy
 * day never grows its week; its chips scroll in it, every one still drawn.
 */
function MonthCell({
  calendar,
  column,
}: {
  readonly calendar: CalendarFrame;
  readonly column: BoardColumn;
}) {
  const { frame, params, fieldId } = calendar;
  const day = dayIn(column, frame);
  const muted = !sameMonth(day, frame.day);
  const { over, handlers } = useDropTarget(calendar, column.value);
  const named = longDay(day);
  return (
    <div
      data-calendar-day={day}
      className={cn(
        monthCellClass,
        "group/day h-28 overflow-y-auto",
        muted && "bg-muted/40",
        over && "bg-accent/60",
      )}
      {...handlers}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-label text-muted-foreground">
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
      <Chips calendar={calendar} rows={column.nodes} lines={2} />
    </div>
  );
}

/**
 * A week's days as seven tall columns side by side, or a day's as one, each
 * listing its rows whole and ending in "+ Add". In a frame narrower than
 * 480px a week stacks its days.
 */
function DayColumns({
  calendar,
  days,
  span,
}: {
  readonly calendar: CalendarFrame;
  readonly days: readonly BoardColumn[];
  readonly span: CalendarViewSpan;
}) {
  return (
    <div
      className={cn("grid border-r border-border", span === "week" && "@min-[480px]:grid-cols-7")}
      data-calendar-layout={span}
    >
      {days.map((column) => (
        <DayColumn key={column.key} calendar={calendar} column={column} span={span} />
      ))}
    </div>
  );
}

function DayColumn({
  calendar,
  column,
  span,
}: {
  readonly calendar: CalendarFrame;
  readonly column: BoardColumn;
  readonly span: CalendarViewSpan;
}) {
  const { frame } = calendar;
  const day = dayIn(column, frame);
  const { over, handlers } = useDropTarget(calendar, column.value);
  return (
    <section
      aria-label={longDay(day)}
      data-calendar-day={day}
      className={cn(
        "flex min-w-0 flex-col gap-px border-b border-l border-border p-0.5",
        span === "week" ? "@min-[480px]:min-h-80" : "min-h-80",
        over && "bg-accent/60",
      )}
      {...handlers}
    >
      <h4 className="flex items-center gap-1 px-0.5 text-label text-muted-foreground">
        <span>{span === "week" ? longDay(day).slice(0, 3) : longDay(day)}</span>
        {span === "week" ? <DayNumber day={day} today={frame.today} /> : null}
      </h4>
      <Chips calendar={calendar} rows={column.nodes} lines="all" />
      <AddToDay calendar={calendar} column={column} />
    </section>
  );
}

/**
 * A month on a phone: each day a button with its number and a dot per row
 * (three at most), opening that day; the open day's rows list under the
 * grid, whole. Selecting a row the keys reach on another day opens that
 * day, so the selected row is always drawn.
 */
function PhoneMonth({
  calendar,
  days,
}: {
  readonly calendar: CalendarFrame;
  readonly days: readonly BoardColumn[];
}) {
  const { frame } = calendar;
  const open = days.find((column) => dayIn(column, frame) === frame.day);
  return (
    <div className="flex flex-col gap-2">
      <MonthGrid>
        {days.map((column) => (
          <DayDot key={column.key} calendar={calendar} column={column} />
        ))}
      </MonthGrid>
      {open === undefined ? null : (
        <section
          aria-label={longDay(frame.day)}
          className="flex min-w-0 flex-col gap-px rounded-md border border-border p-1"
          data-calendar-open-day={frame.day}
        >
          <h4 className="flex items-center justify-between px-1 text-label text-muted-foreground">
            {longDay(frame.day)}
            <span className="tabular-nums">{open.nodes.length}</span>
          </h4>
          <Chips calendar={calendar} rows={open.nodes} lines="all" />
          <AddToDay calendar={calendar} column={open} />
        </section>
      )}
    </div>
  );
}

function DayDot({
  calendar,
  column,
}: {
  readonly calendar: CalendarFrame;
  readonly column: BoardColumn;
}) {
  const { frame } = calendar;
  const day = dayIn(column, frame);
  const muted = !sameMonth(day, frame.day);
  const { over, handlers } = useDropTarget(calendar, column.value);
  const count = column.nodes.length;
  return (
    <button
      type="button"
      data-calendar-day={day}
      aria-pressed={day === frame.day}
      aria-label={`${longDay(day)}, ${count === 1 ? "1 row" : `${count} rows`}`}
      onClick={() => frame.showDay(day)}
      className={cn(
        monthCellClass,
        "min-h-12 items-center text-label outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        muted && "bg-muted/40",
        day === frame.day && "bg-accent",
        over && "bg-accent/60",
      )}
      {...handlers}
    >
      <DayNumber day={day} today={frame.today} muted={muted} />
      <span className="flex h-2 items-center gap-0.5" aria-hidden="true">
        {column.nodes.slice(0, 3).map((row) => (
          <span key={row.id} className="size-1 rounded-full bg-primary" />
        ))}
      </span>
      {column.nodes.map((row) => (
        <FollowSelection
          key={row.id}
          rowId={row.id}
          instanceKey={frame.rowKey(row.id)}
          day={day}
          showDay={frame.showDay}
        />
      ))}
    </button>
  );
}

/**
 * Opens a row's day when it becomes selected, or when the selected row
 * moves to another day; draws nothing. A selection already there when the
 * day is drawn is not followed: arriving at a page selects its first row,
 * and the calendar opens at today all the same.
 */
function FollowSelection({
  rowId,
  instanceKey,
  day,
  showDay,
}: {
  readonly rowId: string;
  readonly instanceKey: string;
  readonly day: string;
  readonly showDay: (day: string) => void;
}) {
  const selected = useIsSelected(rowId, instanceKey);
  const followed = useRef<string | null>(selected ? day : null);
  useEffect(() => {
    if (selected && followed.current !== day) showDay(day);
    followed.current = selected ? day : null;
  }, [selected, day, showDay]);
  return null;
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
      <Chips calendar={calendar} rows={column.nodes} lines="all" />
      <AddRow frame={frame} filters={params.filters} label={`Add to ${column.label}`} />
    </section>
  );
}

/** How many lines a chip's text takes: two in a month's cell, all of it elsewhere. */
type ChipLines = 2 | "all";

function Chips({
  calendar,
  rows,
  lines,
}: {
  readonly calendar: CalendarFrame;
  readonly rows: readonly OutlineNode[];
  readonly lines: ChipLines;
}): ReactNode {
  const { frame, movesBy, drag } = calendar;
  return rows.map((row) => (
    <CalendarChip
      key={row.id}
      row={row}
      instanceKey={frame.rowKey(row.id)}
      RowText={frame.RowText}
      lines={lines}
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
  lines,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  readonly row: OutlineNode;
  readonly instanceKey: string;
  readonly RowText: FrameSubject["RowText"];
  readonly lines: ChipLines;
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
          // The row's text at the chip's density: its label type, clamped in a month's cell unless edited.
          "!min-h-0 touch-auto py-px [&>.node-content]:min-h-0 [&>.node-content]:px-0",
          "[&>.node-content_*]:min-h-0 [&_.kb-text-row]:text-label [&_.kb-text-row]:leading-tight",
          isActive && "select-text",
          !isActive && lines === 2 && "[&_.kb-text-row]:line-clamp-2",
        )}
        content={<RowText node={row} instanceKey={instanceKey} isActive={isActive} tags={[]} />}
      />
    </div>
  );
});
