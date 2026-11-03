/**
 * The routines calendar page (DESIGN-UI.md → The routines calendar): a month,
 * a week or an agenda of every routine's instances, open at a day the URL
 * names. Narrow screens open on the agenda. Every edit is a node write through
 * the page's invoke path; the engine pushes it to Google behind the page.
 */
import { useLayoutEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { parseDay } from "@kb/model";
import { CALENDAR_MODES, type CalendarMode, type CalendarParams } from "@kb/routines";
import { navigate, useNarrowViewport } from "@kb/ui-sdk";
import { useCalendarActions } from "./actions";
import { AgendaView } from "./agenda-view";
import { useCalendarClock } from "./clock";
import { daysOf, stepAnchor, todayIn } from "./dates";
import { useCalendarDrag } from "./drag";
import { EntryPopover } from "./entry-popover";
import { useCalendarModel } from "./model";
import { MonthView } from "./month-view";
import { RoutineEditor } from "./routine-editor";
import { calendarPath } from "./routes";
import { ScopePrompt } from "./scope-prompt";
import { CalendarToolbar, IssuesNote } from "./toolbar";
import { WeekView, type LayoutProps } from "./week-view";

const MODE_KEYS: Readonly<Record<string, CalendarMode>> = { m: "month", w: "week", a: "agenda" };

/** Whether a key press belongs to a field, a modifier chord or an open dialog, not the calendar. */
function notForCalendar(event: KeyboardEvent<HTMLElement>): boolean {
  const target = event.target instanceof HTMLElement ? event.target : null;
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    target === null ||
    target.isContentEditable ||
    ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
    target.closest('[role="dialog"]') !== null
  );
}

export function CalendarPage({ params }: { readonly params: CalendarParams }) {
  const clock = useCalendarClock();
  const narrow = useNarrowViewport();
  const now = clock.now();
  const today = todayIn(clock.zone, now);
  const mode = params.mode ?? (narrow ? "agenda" : "week");
  const anchor = params.date !== undefined && parseDay(params.date) !== null ? params.date : today;
  const days = useMemo(() => daysOf(mode, anchor), [mode, anchor]);
  const model = useCalendarModel(days, clock.zone);
  const actions = useCalendarActions(model, clock.zone);
  const { drag, pressEntry, pressEdge, pressSlot } = useCalendarDrag({
    click: actions.open,
    move: actions.move,
    resize: actions.resize,
    create: actions.create,
  });
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => root.current?.focus({ preventScroll: true }), []);

  const go = (next: { mode?: CalendarMode; date?: string }) =>
    navigate(calendarPath({ mode: next.mode ?? mode, date: next.date ?? anchor }));
  const step = (direction: 1 | -1) => go({ date: stepAnchor(mode, anchor, direction) });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (notForCalendar(event)) return;
    const key = event.key.toLowerCase();
    const modeKey = MODE_KEYS[key];
    if (modeKey !== undefined) go({ mode: modeKey });
    else if (key === "t") go({ date: today });
    else if (key === "arrowright" || key === "j" || key === "n") step(1);
    else if (key === "arrowleft" || key === "k" || key === "p") step(-1);
    else if (key === "c") actions.create(anchor, { from: 9 * 60, to: 9 * 60 + 30 });
    else return;
    event.preventDefault();
  };

  const layout: LayoutProps = {
    days,
    model,
    zone: clock.zone,
    today,
    now,
    drag,
    presses: { pressEntry, pressEdge, pressSlot, open: actions.open },
  };
  const opened = actions.opened;
  const openedEntry =
    opened === null
      ? undefined
      : [...model.byDay.values()].flat().find((entry) => entry.key === opened.key);
  return (
    <div
      ref={root}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="routines-calendar"
      data-calendar-mode={mode}
      aria-label="Routines calendar"
      className="flex h-full min-h-0 flex-col bg-background text-foreground outline-none"
    >
      <CalendarToolbar
        mode={mode}
        anchor={anchor}
        narrow={narrow}
        model={model}
        onMode={(next) => go({ mode: next })}
        onStep={step}
        onToday={() => go({ date: today })}
        onNew={() => actions.create(anchor, null)}
        modes={CALENDAR_MODES}
      />
      <IssuesNote issues={model.issues} onOpen={actions.edit} />
      {mode === "week" ? <WeekView {...layout} /> : null}
      {mode === "month" ? (
        <MonthView
          layout={layout}
          anchor={anchor}
          openDay={(day) => go({ mode: "week", date: day })}
        />
      ) : null}
      {mode === "agenda" ? <AgendaView layout={layout} actions={actions} /> : null}
      {opened !== null && openedEntry !== undefined ? (
        <EntryPopover
          entry={openedEntry}
          element={opened.element}
          model={model}
          zone={clock.zone}
          actions={actions}
          onClose={actions.closeOpened}
        />
      ) : null}
      {actions.pending === null ? null : (
        <ScopePrompt
          entry={actions.pending.entry}
          onChoose={actions.choose}
          onCancel={actions.cancelMove}
        />
      )}
      {actions.editor === null ? null : (
        <RoutineEditor target={actions.editor} model={model} onClose={actions.closeEditor} />
      )}
    </div>
  );
}
