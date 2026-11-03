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
  describeRepeat,
  editRoutine,
  knownZone,
  project,
  readSyncStatus,
  routineSettings,
  type RoutineSettings,
} from "@kb/routines";
import { cn } from "@kb/ui-sdk";
import { BUTTON_CLASS, Dialog, PRIMARY_BUTTON_CLASS } from "./dialog";
import type { CalendarModel } from "./model";
import { FIELD_CLASS, RepeatPicker } from "./repeat-picker";
import { StatusDot } from "./status-dot";
import { syncShown } from "./sync-shown";
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

function startOf(target: EditorTarget, model: CalendarModel) {
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
  readonly model: CalendarModel;
  readonly calendar: string;
}) {
  const node = model.nodes.get(id);
  const status = node === undefined ? null : readSyncStatus(node);
  const mode = model.calendars.get(calendar)?.mode;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-meta"
      data-routine-sync=""
    >
      <StatusDot status={status} calendarMode={mode} className="h-2 w-2" />
      <span className="min-w-0 flex-1 text-muted-foreground">{syncShown(status, mode).text}</span>
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

function WhenFields({
  settings,
  set,
}: {
  readonly settings: RoutineSettings;
  readonly set: (changes: Partial<RoutineSettings>) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date">
          <input
            type="date"
            aria-label="Date"
            className={FIELD_CLASS}
            value={settings.starts}
            onChange={(event) => set({ starts: event.target.value })}
          />
        </Field>
        <Field label="Time">
          <input
            type="time"
            aria-label="Time"
            step={300}
            className={FIELD_CLASS}
            disabled={settings.at === ""}
            value={settings.at}
            onChange={(event) => set({ at: event.target.value })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-ui text-foreground">
          <input
            type="checkbox"
            aria-label="All day"
            checked={settings.at === ""}
            onChange={(event) => set({ at: event.target.checked ? "" : "09:00" })}
          />
          All day
        </label>
        <label className="flex items-center gap-1.5 text-ui text-foreground">
          <input
            type="number"
            aria-label="Duration in minutes"
            min={5}
            step={5}
            className={cn(FIELD_CLASS, "w-20")}
            value={settings.duration}
            onChange={(event) => set({ duration: Number(event.target.value) })}
          />
          minutes
        </label>
      </div>
    </>
  );
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
      ) : null}
      <button type="button" className={BUTTON_CLASS} onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={!ok}>
        Save
      </button>
    </div>
  );
}

export function RoutineEditor({
  target,
  model,
  onClose,
}: {
  readonly target: EditorTarget;
  readonly model: CalendarModel;
  readonly onClose: () => void;
}) {
  const [start] = useState(() => startOf(target, model));
  const [title, setTitle] = useState(start.title);
  const [settings, setSettings] = useState(start.settings);
  const set = (changes: Partial<RoutineSettings>) => setSettings((now) => ({ ...now, ...changes }));
  const ok = sendable(title, settings, DEFAULT_ROUTINE_ZONE);
  const save = async () => {
    const calls =
      target.kind === "new"
        ? [
            addRoutine({
              id: mintId(),
              title: title.trim() === "" ? "Untitled routine" : title,
              settings,
            }),
          ]
        : editRoutine(target.id, start, { title, settings });
    if (await runCalls(calls, "Could not save the routine")) onClose();
  };
  const remove = async () => {
    if (
      target.kind === "routine" &&
      (await runCalls([deleteNode(target.id)], "Could not delete the routine"))
    )
      onClose();
  };
  return (
    <Dialog
      title={target.kind === "new" ? "New routine" : "Edit routine"}
      onClose={onClose}
      testId="routine-editor"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ok) void save();
        }}
      >
        <Field label="Title">
          <input
            autoFocus
            aria-label="Title"
            className={FIELD_CLASS}
            value={title}
            placeholder="Morning run"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <WhenFields settings={settings} set={set} />
        <Field
          label={`Repeat · ${describeRepeat(settings.rrule, settings.until, settings.starts === "" ? "1970-01-01" : settings.starts)}`}
        >
          <RepeatPicker
            starts={settings.starts}
            value={settings}
            onChange={(value) => set(value)}
          />
        </Field>
        <Field label="Calendar">
          <select
            aria-label="Calendar"
            className={FIELD_CLASS}
            value={settings.calendar}
            onChange={(event) => set({ calendar: event.target.value })}
          >
            <option value="">No calendar (not synced)</option>
            {[...model.calendars.values()].map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
              </option>
            ))}
          </select>
        </Field>
        {target.kind === "routine" ? (
          <SyncRow id={target.id} model={model} calendar={settings.calendar} />
        ) : null}
        {start.warnings.length > 0 ? (
          <p className="text-meta text-warning">
            Some fields could not be read: {start.warnings.join("; ")}
          </p>
        ) : null}
        {ok ? null : (
          <p className="text-meta text-destructive" role="alert">
            kb cannot send this routine yet: check its date, time and repeat.
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
