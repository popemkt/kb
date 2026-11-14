/**
 * The friendly repeat picker: a routine's one RRULE, chosen by name (daily,
 * weekly on its day, every weekday, …), built from parts (every n weeks on
 * these days), ended on a day or after n times, or typed as a rule. Each
 * choice writes the rule `@kb/routines` reads back, so reopening a routine
 * shows the choice it was made with.
 */
import { useId, useState } from "react";
import {
  canonicalRule,
  describeRepeat,
  FREQUENCIES,
  readRepeat,
  repeatPresets,
  repeatRule,
  WEEKDAYS,
  type Frequency,
  type Repeat,
} from "@kb/routines";
import { cn } from "@kb/ui-sdk";
import { WEEKDAY_SHORT } from "@kb/calendar-kit";

export interface RepeatValue {
  readonly rrule: string;
  /** The last day it repeats on, empty for no end day. */
  readonly until: string;
}

const UNIT: Readonly<Record<Frequency, string>> = {
  DAILY: "days",
  WEEKLY: "weeks",
  MONTHLY: "months",
  YEARLY: "years",
};
export const FIELD_CLASS =
  "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-ui text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring";
const LABEL_CLASS = "text-label text-muted-foreground";

function presetOf(rrule: string, starts: string): string {
  if (rrule.trim() === "") return "none";
  const repeat = readRepeat(rrule, starts);
  if (repeat === null || repeat.count !== null) return "custom";
  const own = repeatRule(repeat, starts);
  return repeatPresets(starts).find((preset) => preset.rrule === own)?.id ?? "custom";
}

function CustomRepeat({
  repeat,
  starts,
  onChange,
}: {
  readonly repeat: Repeat;
  readonly starts: string;
  readonly onChange: (repeat: Repeat) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2" data-repeat-custom="">
      <label className="flex items-center gap-2" htmlFor={id}>
        <span className={LABEL_CLASS}>Every</span>
        <input
          id={id}
          type="number"
          min={1}
          aria-label="Repeat every"
          className={cn(FIELD_CLASS, "w-16")}
          value={repeat.interval}
          onChange={(event) =>
            onChange({ ...repeat, interval: Math.max(1, Number(event.target.value)) })
          }
        />
        <select
          aria-label="Repeat unit"
          className={FIELD_CLASS}
          value={repeat.freq}
          onChange={(event) => {
            const freq = FREQUENCIES.find((value) => value === event.target.value) ?? "WEEKLY";
            onChange({ ...repeat, freq, byDay: [] });
          }}
        >
          {FREQUENCIES.map((freq) => (
            <option key={freq} value={freq}>
              {repeat.interval === 1 ? UNIT[freq].slice(0, -1) : UNIT[freq]}
            </option>
          ))}
        </select>
      </label>
      {repeat.freq === "WEEKLY" ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="On days">
          {WEEKDAYS.map((day, index) => {
            const on = repeat.byDay.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                className={cn(
                  "h-7 w-9 rounded-md border text-label text-foreground",
                  on ? "border-primary bg-primary/15" : "border-border",
                )}
                onClick={() =>
                  onChange({
                    ...repeat,
                    byDay: on
                      ? repeat.byDay.filter((other) => other !== day)
                      : [...repeat.byDay, day],
                  })
                }
              >
                {WEEKDAY_SHORT[index]}
              </button>
            );
          })}
        </div>
      ) : null}
      {repeat.freq === "MONTHLY" ? (
        <select
          aria-label="Monthly on"
          className={FIELD_CLASS}
          value={repeat.monthly}
          onChange={(event) =>
            onChange({ ...repeat, monthly: event.target.value === "weekday" ? "weekday" : "day" })
          }
        >
          {repeatPresets(starts)
            .filter((preset) => preset.id.startsWith("monthly"))
            .map((preset) => (
              <option key={preset.id} value={preset.id === "monthly" ? "day" : "weekday"}>
                {preset.label.replace("Monthly ", "")}
              </option>
            ))}
        </select>
      ) : null}
    </div>
  );
}

function RepeatEnds({
  value,
  repeat,
  starts,
  onChange,
}: {
  readonly value: RepeatValue;
  readonly repeat: Repeat | null;
  readonly starts: string;
  readonly onChange: (value: RepeatValue) => void;
}) {
  const ends =
    value.until !== "" ? "on" : repeat !== null && repeat.count !== null ? "after" : "never";
  const setEnds = (next: string) => {
    const base =
      repeat === null
        ? value.rrule
        : repeatRule({ ...repeat, count: next === "after" ? 10 : null }, starts);
    onChange({ rrule: base, until: next === "on" ? starts : "" });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={LABEL_CLASS}>Ends</span>
      <select
        aria-label="Ends"
        className={FIELD_CLASS}
        value={ends}
        onChange={(event) => setEnds(event.target.value)}
      >
        <option value="never">Never</option>
        <option value="on">On a day</option>
        {repeat !== null ? <option value="after">After a number of times</option> : null}
      </select>
      {ends === "on" ? (
        <input
          type="date"
          aria-label="Last day"
          className={FIELD_CLASS}
          min={starts}
          value={value.until}
          onChange={(event) => onChange({ ...value, until: event.target.value })}
        />
      ) : null}
      {ends === "after" && repeat !== null ? (
        <input
          type="number"
          min={1}
          aria-label="Times"
          className={cn(FIELD_CLASS, "w-20")}
          value={repeat.count ?? 1}
          onChange={(event) =>
            onChange({
              ...value,
              rrule: repeatRule(
                { ...repeat, count: Math.max(1, Number(event.target.value)) },
                starts,
              ),
            })
          }
        />
      ) : null}
    </div>
  );
}

/** The rule typed as text: what a choice the picker cannot name is edited as. */
function RawRule({
  value,
  onChange,
}: {
  readonly value: RepeatValue;
  readonly onChange: (value: RepeatValue) => void;
}) {
  const [text, setText] = useState(value.rrule);
  const [valid, setValid] = useState(true);
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL_CLASS}>Rule (RRULE)</span>
      <input
        aria-label="Rule"
        aria-invalid={!valid}
        className={cn(FIELD_CLASS, "font-mono", !valid && "border-destructive")}
        value={text}
        placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
        onChange={(event) => {
          setText(event.target.value);
          try {
            const rule =
              event.target.value.trim() === ""
                ? ""
                : canonicalRule(event.target.value).replace(/^RRULE:/, "");
            setValid(true);
            onChange({ ...value, rrule: rule });
          } catch {
            setValid(false);
          }
        }}
      />
      {valid ? null : <span className="text-meta text-destructive">Not a rule kb can send.</span>}
    </label>
  );
}

export function RepeatPicker({
  starts,
  value,
  onChange,
}: {
  readonly starts: string;
  readonly value: RepeatValue;
  readonly onChange: (value: RepeatValue) => void;
}) {
  const [custom, setCustom] = useState(() => presetOf(value.rrule, starts) === "custom");
  const repeat = readRepeat(value.rrule, starts);
  const choice = custom ? "custom" : presetOf(value.rrule, starts);
  const presets = repeatPresets(starts);
  // What the rule does in words, said only when the option chosen does not already say it.
  const summary = describeRepeat(value.rrule, value.until, starts === "" ? "1970-01-01" : starts);
  const said = presets.find((preset) => preset.id === choice)?.label;
  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label="Repeat"
        className={FIELD_CLASS}
        value={choice}
        onChange={(event) => {
          const id = event.target.value;
          setCustom(id === "custom");
          if (id === "custom") {
            if (repeat === null && value.rrule === "")
              onChange({
                ...value,
                rrule: repeatRule(
                  { freq: "WEEKLY", interval: 1, byDay: [], monthly: "day", count: null },
                  starts,
                ),
              });
            return;
          }
          const rrule = presets.find((preset) => preset.id === id)?.rrule ?? "";
          onChange({ rrule, until: rrule === "" ? "" : value.until });
        }}
      >
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {summary === said ? null : (
        <p className="text-meta text-muted-foreground" data-repeat-summary="">
          {summary}
        </p>
      )}
      {choice === "custom" && repeat !== null ? (
        <CustomRepeat
          repeat={repeat}
          starts={starts}
          onChange={(next) => onChange({ ...value, rrule: repeatRule(next, starts) })}
        />
      ) : null}
      {choice === "custom" && repeat === null ? (
        <RawRule value={value} onChange={onChange} />
      ) : null}
      {value.rrule === "" ? null : (
        <RepeatEnds value={value} repeat={repeat} starts={starts} onChange={onChange} />
      )}
    </div>
  );
}
