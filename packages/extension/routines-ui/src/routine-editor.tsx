/**
 * Opening a routine: its title, day, time, how long it lasts, how it repeats
 * and which calendar it is on, with its sync state beside. Saving writes the
 * fields that changed (`editRoutine`) or makes the routine (`addRoutine`) in
 * one call. What the engine could not send is said before it is saved.
 */
import { useState, type ReactNode } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import {
  addRoutine,
  DEFAULT_ROUTINE_ZONE,
  deleteNode,
  editRoutine,
  knownZone,
  project,
  readSyncStatus,
  routineSettings,
  type RoutineSettings,
} from "@kb/routines";
import { cn } from "@kb/ui-sdk";
import { BUTTON_CLASS, Dialog, PRIMARY_BUTTON_CLASS } from "./dialog";
import { useCalendarClock } from "./clock";
import type { CalendarGraph } from "./model";
import { DateField } from "./date-field";
import { FIELD_CLASS, RepeatPicker } from "./repeat-picker";
import { StatusDot } from "./status-dot";
import { syncShown } from "./sync-shown";
import { TimeField } from "./time-field";
import { clockOf, DAY_MINUTES, lengthBetween, lengthText, minutesOf } from "./time-text";
import { mintId, runCalls, syncNow } from "./writes";

/** What the editor opens: a routine, or a new one with the settings it starts from. */
export type EditorTarget =
  | { readonly kind: "routine"; readonly id: string }
  | { readonly kind: "new"; readonly settings: Partial<RoutineSettings> };

const BLANK: RoutineSettings = {
  starts: "",
  at: "",
  duration: 30,
  zone: "",
  rrule: "",
  until: "",
  repeatsFrom: "schedule",
  calendar: "",
};

/** Whether the engine would send a routine with these settings. */
function sendable(title: string, settings: RoutineSettings, zone: string): boolean {
  try {
    project(
      {
        id: "draft",
        title,
        starts: settings.starts,
        at: settings.at === "" ? null : settings.at,
        duration: settings.duration,
        zone: knownZone(settings.zone) ? settings.zone : zone,
        rrule: settings.rrule,
        until: settings.until === "" ? null : settings.until,
        repeatsFrom: settings.repeatsFrom ?? "schedule",
      },
      "",
      0,
    );
    return true;
  } catch {
    return false;
  }
}

function startOf(target: EditorTarget, model: CalendarGraph) {
  if (target.kind === "new") {
    const only = model.calendars.size === 1 ? [...model.calendars.keys()][0] : undefined;
    return {
      title: "",
      settings: { ...BLANK, calendar: only ?? "", ...target.settings },
      warnings: [],
    };
  }
  const node = model.nodes.get(target.id);
  const read = routineSettings(node ?? { props: {} });
  return { title: node?.text ?? "", settings: read.settings, warnings: read.warnings };
}

function SyncRow({
  id,
  model,
  calendar,
}: {
  readonly id: string;
  readonly model: CalendarGraph;
  readonly calendar: string;
}) {
  const node = model.nodes.get(id);
  const status = node === undefined ? null : readSyncStatus(node);
  const mode = model.calendars.get(calendar)?.mode;
  const { zone } = useCalendarClock();
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-meta"
      data-routine-sync=""
    >
      <StatusDot status={status} calendarMode={mode} className="h-2 w-2" />
      <span className="min-w-0 flex-1 text-muted-foreground">
        {syncShown(status, mode, zone).text}
      </span>
      {status?.url === undefined ? null : (
        <a
          className="inline-flex items-center gap-1 text-primary hover:underline"
          href={status.url}
          target="_blank"
          rel="noreferrer"
        >
          Open in Google Calendar <ArrowSquareOutIcon size={12} />
        </a>
      )}
      <button type="button" className="text-primary hover:underline" onClick={() => void syncNow()}>
        Sync now
      </button>
    </div>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** The All day switch: a routine with no time is on its days, not at an hour. */
function AllDaySwitch({
  on,
  onChange,
}: {
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="All day"
      onClick={() => onChange(!on)}
      className="inline-flex h-8 items-center gap-2 rounded-md px-1 text-ui text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors",
          on ? "border-primary bg-primary" : "border-input bg-muted",
        )}
      >
        <span
          className={cn(
            "h-3 w-3 rounded-full bg-background shadow-edge transition-transform",
            on ? "translate-x-3" : "translate-x-0.5",
          )}
        />
      </span>
      All day
    </button>
  );
}

/** Which time fields hold text that is not a time yet. */
interface Unreadable {
  readonly start: boolean;
  readonly end: boolean;
}

function WhenFields({
  settings,
  set,
  today,
  onUnreadable,
}: {
  readonly settings: RoutineSettings;
  readonly set: (changes: Partial<RoutineSettings>) => void;
  readonly today: string;
  readonly onUnreadable: (changes: Partial<Unreadable>) => void;
}) {
  const allDay = settings.at === "";
  // The time it had before All day, given back when All day is switched off.
  const [lastAt, setLastAt] = useState(allDay ? "09:00" : settings.at);
  const ends = allDay ? "" : clockOf(minutesOf(settings.at) + settings.duration);
  // An end at 00:00 is the next day's midnight, so it ends the next day too.
  const nextDay = !allDay && minutesOf(settings.at) + settings.duration >= DAY_MINUTES;
  return (
    <div className="flex flex-col gap-2" data-routine-when="">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Day">
          <DateField
            label="Date"
            value={settings.starts}
            today={today}
            onChange={(starts) => set({ starts })}
          />
        </Field>
        <AllDaySwitch
          on={allDay}
          onChange={(on) => {
            if (on) setLastAt(settings.at);
            onUnreadable({ start: false, end: false });
            set({ at: on ? "" : lastAt });
          }}
        />
      </div>
      {allDay ? null : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Starts">
            <TimeField
              label="Starts"
              value={settings.at}
              onChange={(at) => set({ at })}
              onText={(readable) => onUnreadable({ start: !readable })}
            />
          </Field>
          <span className="pb-1.5 text-muted-foreground" aria-hidden>
            –
          </span>
          <Field label="Ends">
            <TimeField
              label="Ends"
              value={ends}
              onChange={(end) => set({ duration: lengthBetween(settings.at, end) })}
              onText={(readable) => onUnreadable({ end: !readable })}
              hint={(time) => lengthText(lengthBetween(settings.at, time))}
              after={settings.at}
            />
          </Field>
          <span className="pb-1.5 text-meta text-muted-foreground" data-routine-length="">
            {lengthText(settings.duration)}
            {nextDay ? ", ends the next day" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

/** What stops the draft from being saved, in words, or null when nothing does. */
function problemOf(
  settings: RoutineSettings,
  unreadable: Unreadable,
  sends: boolean,
): string | null {
  if (settings.starts === "") return "Choose the day it starts.";
  if (settings.at !== "" && unreadable.start)
    return "The start time isn't a time yet. Type it as 9:30, 930 or 9:30pm.";
  if (settings.at !== "" && unreadable.end)
    return "The end time isn't a time yet. Type it as 10:00, 1000 or 10pm.";
  if (settings.at !== "" && settings.duration <= 0) return "It has to end after it starts.";
  if (settings.until !== "" && settings.until < settings.starts)
    return "The repeat ends before the day it starts. Move the end day, or the start.";
  if (!sends) return "kb can't send this repeat as it stands. Pick a preset, or check the rule.";
  return null;
}

function EditorButtons({
  existing,
  ok,
  onDelete,
  onClose,
}: {
  readonly existing: boolean;
  readonly ok: boolean;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
      {existing ? (
        <button
          type="button"
          className={cn(BUTTON_CLASS, "mr-auto text-destructive")}
          onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
        >
          {confirmDelete ? "Delete it and its history" : "Delete"}
        </button>
      ) : (
        <span className="mr-auto text-meta text-muted-foreground" data-editor-keys="">
          Enter saves · Esc closes
        </span>
      )}
      <button type="button" className={BUTTON_CLASS} onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={!ok}>
        Save
      </button>
    </div>
  );
}

/** Which calendar the routine is on, or none, which syncs nothing. */
function CalendarField({
  model,
  value,
  onChange,
}: {
  readonly model: CalendarGraph;
  readonly value: string;
  readonly onChange: (calendar: string) => void;
}) {
  return (
    <Field label="Calendar">
      <select
        aria-label="Calendar"
        className={FIELD_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">No calendar (not synced)</option>
        {[...model.calendars.values()].map((calendar) => (
          <option key={calendar.id} value={calendar.id}>
            {calendar.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function RoutineEditor({
  target,
  model,
  today,
  onClose,
}: {
  readonly target: EditorTarget;
  readonly model: CalendarGraph;
  /** Today on the page's clock, which the date picker marks. */
  readonly today: string;
  readonly onClose: () => void;
}) {
  const [start] = useState(() => startOf(target, model));
  const [title, setTitle] = useState(start.title);
  const [settings, setSettings] = useState(start.settings);
  const [unreadable, setUnreadable] = useState<Unreadable>({ start: false, end: false });
  const set = (changes: Partial<RoutineSettings>) => setSettings((now) => ({ ...now, ...changes }));
  const problem = problemOf(settings, unreadable, sendable(title, settings, DEFAULT_ROUTINE_ZONE));
  const ok = problem === null;
  const save = async () => {
    const calls =
      target.kind === "new"
        ? [
            addRoutine({
              id: mintId(),
              title: title.trim() === "" ? "Untitled event" : title,
              settings,
            }),
          ]
        : editRoutine(target.id, start, { title, settings });
    if (await runCalls(calls, "Could not save the event")) onClose();
  };
  const remove = async () => {
    if (
      target.kind === "routine" &&
      (await runCalls([deleteNode(target.id)], "Could not delete the event"))
    )
      onClose();
  };
  return (
    <Dialog
      title={target.kind === "new" ? "New event" : "Edit event"}
      onClose={onClose}
      testId="routine-editor"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ok) void save();
        }}
        onKeyDown={(event) => {
          // Enter in a field saves as a form does; with a modifier it saves from anywhere.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
      >
        <Field label="Title">
          <input
            autoFocus
            aria-label="Title"
            className={cn(FIELD_CLASS, "h-9 text-lead")}
            value={title}
            placeholder="Morning run"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <WhenFields
          settings={settings}
          set={set}
          today={today}
          onUnreadable={(changes) => setUnreadable((now) => ({ ...now, ...changes }))}
        />
        <Field label="Repeat">
          <RepeatPicker
            starts={settings.starts}
            value={settings}
            onChange={(value) => set(value)}
          />
        </Field>
        <CalendarField
          model={model}
          value={settings.calendar}
          onChange={(calendar) => set({ calendar })}
        />
        {target.kind === "routine" ? (
          <SyncRow id={target.id} model={model} calendar={settings.calendar} />
        ) : null}
        {start.warnings.length > 0 ? (
          <p className="text-meta text-warning">
            Some fields could not be read: {start.warnings.join("; ")}
          </p>
        ) : null}
        {problem === null ? null : (
          <p className="text-meta text-destructive" role="alert" data-editor-problem="">
            {problem}
          </p>
        )}
        <EditorButtons
          existing={target.kind === "routine"}
          ok={ok}
          onDelete={() => void remove()}
          onClose={onClose}
        />
      </form>
    </Dialog>
  );
}
