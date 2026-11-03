import { CaretLeftIcon, CaretRightIcon, PlusIcon, WarningIcon } from "@phosphor-icons/react";
import type { CalendarIssue, CalendarMode } from "@kb/routines";
import { cn, IconButton } from "@kb/ui-sdk";
import { titleOf } from "./dates";
import { BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "./dialog";
import type { CalendarModel } from "./model";
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
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
      role="toolbar"
      aria-label="Calendar"
    >
      <button type="button" className={BUTTON_CLASS} onClick={onToday} title="Today (t)">
        Today
      </button>
      <div className="flex items-center">
        <IconButton
          label="Previous (k)"
          icon={CaretLeftIcon}
          size="md"
          onClick={() => onStep(-1)}
        />
        <IconButton label="Next (j)" icon={CaretRightIcon} size="md" onClick={() => onStep(1)} />
      </div>
      <h1
        className={cn("min-w-0 truncate text-foreground", narrow ? "text-lead" : "text-title")}
        data-calendar-title=""
      >
        {titleOf(mode, anchor)}
      </h1>
      <div className="ml-auto flex items-center gap-2">
        <div
          className="flex rounded-md border border-border p-0.5"
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
                "rounded-sm px-2 py-0.5 text-label text-foreground",
                each === mode ? "bg-accent shadow-edge" : "hover:bg-accent/60",
              )}
            >
              {MODE_LABELS[each]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => void syncNow()}
          title={`Sync now · ${summary.text}`}
          data-sync-summary={summary.state}
        >
          <span className={cn("h-2 w-2 rounded-full", SYNC_DOTS[summary.state])} aria-hidden />
          {narrow ? "Sync" : `Sync now · ${summary.text}`}
        </button>
        <button
          type="button"
          className={PRIMARY_BUTTON_CLASS}
          onClick={onNew}
          title="New routine (c)"
        >
          <PlusIcon size={12} weight="bold" />
          {narrow ? null : "New"}
        </button>
      </div>
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
          ? "1 routine cannot be shown:"
          : `${String(issues.length)} routines cannot be shown:`}
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
