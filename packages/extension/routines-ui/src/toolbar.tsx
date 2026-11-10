import {
  ArrowsClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CloudIcon,
  PlusIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { ROUTINE_TAGS, type CalendarIssue, type CalendarMode } from "@kb/routines";
import { nodesOfKind } from "@kb/model";
import { cn, navigate } from "@kb/ui-sdk";
import { titleOf } from "./dates";
import { BUTTON_CLASS, ICON_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "./dialog";
import type { CalendarModel } from "./model";
import { syncPath } from "./routes";
import { SYNC_DOTS, syncShown, type SyncShown } from "./sync-shown";
import { syncNow } from "./writes";

const MODE_LABELS: Readonly<Record<CalendarMode, string>> = {
  month: "Month",
  week: "Week",
  agenda: "Agenda",
};

/** How the instances shown stand with Google: the worst state among them, counted. */
function syncSummary(model: CalendarModel): { readonly state: SyncShown; readonly text: string } {
  const shown = [...model.byDay.values()]
    .flat()
    .map((entry) => syncShown(entry.status, model.calendars.get(entry.calendar)?.mode).state);
  const failed = shown.filter((state) => state === "error").length;
  const waiting = shown.filter((state) => state === "pending").length;
  if (failed > 0) return { state: "error", text: `${String(failed)} failed` };
  if (waiting > 0) return { state: "pending", text: `${String(waiting)} waiting` };
  if ([...model.calendars.values()].some((calendar) => calendar.mode === "on"))
    return { state: "synced", text: "Synced" };
  return { state: "none", text: "Not syncing" };
}

/** Where the calendar stands with Google, as text with its dot: read, not pressed. */
function SyncStatus({ summary }: { readonly summary: ReturnType<typeof syncSummary> }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-meta text-muted-foreground"
      data-sync-summary={summary.state}
      role="status"
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", SYNC_DOTS[summary.state])} aria-hidden />
      {summary.text}
    </span>
  );
}

/** One group of the toolbar's controls, divided from the next. */
const GROUP = "flex items-center gap-1";

/** The layouts, one pressed. */
function LayoutGroup({
  mode,
  modes,
  onMode,
}: {
  readonly mode: CalendarMode;
  readonly modes: readonly CalendarMode[];
  readonly onMode: (mode: CalendarMode) => void;
}) {
  return (
    <div
      className="flex h-8 items-center rounded-md border border-border p-0.5"
      role="group"
      aria-label="Layout"
    >
      {modes.map((each) => (
        <button
          key={each}
          type="button"
          aria-pressed={each === mode}
          title={`${MODE_LABELS[each]} (${each.slice(0, 1)})`}
          onClick={() => onMode(each)}
          className={cn(
            "h-full rounded-sm px-2.5 text-label text-foreground",
            each === mode ? "bg-accent shadow-edge" : "hover:bg-accent/60",
          )}
        >
          {MODE_LABELS[each]}
        </button>
      ))}
    </div>
  );
}

/** Sync's group: where the calendar stands, Sync now and Sync services; or Set up sync. */
function SyncControls({
  narrow,
  summary,
  hasService,
}: {
  readonly narrow: boolean;
  readonly summary: ReturnType<typeof syncSummary>;
  readonly hasService: boolean;
}) {
  return (
    <div className={cn(GROUP, "border-l border-border pl-3")} role="group" aria-label="Sync">
      {hasService ? (
        <>
          {narrow ? null : <SyncStatus summary={summary} />}
          <button
            type="button"
            className={ICON_BUTTON_CLASS}
            aria-label="Sync now"
            title={`Sync now · ${summary.text}`}
            data-sync-now=""
            onClick={() => void syncNow()}
          >
            <ArrowsClockwiseIcon size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={ICON_BUTTON_CLASS}
            aria-label="Sync services"
            title="Sync services"
            onClick={() => navigate(syncPath())}
          >
            <CloudIcon size={16} aria-hidden />
          </button>
        </>
      ) : (
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => navigate(syncPath())}
          data-sync-summary={summary.state}
        >
          <ArrowsClockwiseIcon size={14} aria-hidden />
          {narrow ? "Sync" : "Set up sync"}
        </button>
      )}
    </div>
  );
}

export function CalendarToolbar({
  mode,
  anchor,
  narrow,
  model,
  modes,
  onMode,
  onStep,
  onToday,
  onNew,
}: {
  readonly mode: CalendarMode;
  readonly anchor: string;
  readonly narrow: boolean;
  readonly model: CalendarModel;
  readonly modes: readonly CalendarMode[];
  readonly onMode: (mode: CalendarMode) => void;
  readonly onStep: (direction: 1 | -1) => void;
  readonly onToday: () => void;
  readonly onNew: () => void;
}) {
  const summary = syncSummary(model);
  const hasService = nodesOfKind(model.nodes, ROUTINE_TAGS.account).length > 0;
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2"
      role="toolbar"
      aria-label="Calendar"
    >
      <div className={GROUP} role="group" aria-label="Go to">
        <button type="button" className={BUTTON_CLASS} onClick={onToday} title="Today (t)">
          Today
        </button>
        <button
          type="button"
          className={ICON_BUTTON_CLASS}
          aria-label="Previous (k)"
          title="Previous (k)"
          onClick={() => onStep(-1)}
        >
          <CaretLeftIcon size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={ICON_BUTTON_CLASS}
          aria-label="Next (j)"
          title="Next (j)"
          onClick={() => onStep(1)}
        >
          <CaretRightIcon size={16} aria-hidden />
        </button>
      </div>
      <h1
        className={cn(
          "min-w-0 flex-1 truncate text-foreground",
          narrow ? "text-lead" : "text-title",
        )}
        data-calendar-title=""
      >
        {titleOf(mode, anchor)}
      </h1>
      <LayoutGroup mode={mode} modes={modes} onMode={onMode} />
      <SyncControls narrow={narrow} summary={summary} hasService={hasService} />
      <button
        type="button"
        className={PRIMARY_BUTTON_CLASS}
        onClick={onNew}
        title="New event (c)"
        aria-label={narrow ? "New event" : undefined}
      >
        <PlusIcon size={12} weight="bold" aria-hidden />
        {narrow ? null : "New"}
      </button>
    </div>
  );
}

/** The routines the calendar cannot show, each opened to be mended. */
export function IssuesNote({
  issues,
  onOpen,
}: {
  readonly issues: readonly CalendarIssue[];
  readonly onOpen: (routine: string) => void;
}) {
  if (issues.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-warning/10 px-3 py-1.5 text-meta"
      role="status"
    >
      <WarningIcon size={14} className="text-warning" />
      <span className="text-foreground">
        {issues.length === 1
          ? "1 event cannot be shown:"
          : `${String(issues.length)} events cannot be shown:`}
      </span>
      {issues.map((issue) => (
        <button
          key={issue.routine}
          type="button"
          className="text-primary hover:underline"
          onClick={() => onOpen(issue.routine)}
        >
          {issue.title === "" ? "Untitled" : issue.title} ({issue.code.replaceAll("_", " ")})
        </button>
      ))}
    </div>
  );
}
