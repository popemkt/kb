/**
 * The one control a knob is drawn with (`@kb/model`'s `Knob`): a lab
 * study's parameters and a backdrop's knobs are the same schema, so they are
 * drawn, labelled and reached by keyboard the same way, wherever a panel
 * lists them. It says two things: each move (`onChange`, every step of a
 * drag), and the value it settles on (`onCommit`: a slider let go or
 * stepped by a key, a colour picked, a field left, a choice made), so a
 * reader that keeps the value writes once per gesture, not once per move.
 */
import { useCallback, useEffect, useId, useRef, type ReactNode, type RefCallback } from "react";
import { DiceFiveIcon } from "@phosphor-icons/react";
import {
  KNOB_COLOR,
  type ColorKnob,
  type Knob,
  type KnobValue,
  type NumberKnob,
  type SeedKnob,
} from "@kb/model";
import { EnumSelect } from "./enum-select";

/** What one kind's control is handed: its knob, the value now (none, its default), and where a move and a settled value go. */
interface ControlProps<K extends Knob> {
  readonly id: string;
  readonly knob: K;
  readonly value: KnobValue | undefined;
  readonly onChange: (value: KnobValue) => void;
  readonly onCommit: (value: KnobValue) => void;
}

/**
 * The ref of an input whose settled value goes to `onCommit`, read by
 * `read` (none, a value it does not accept): the DOM's own `change`, which
 * fires when a slider is let go or stepped by a key, a colour is picked or
 * a field is left, never on each move.
 */
function useSettled(
  read: (input: HTMLInputElement) => KnobValue | undefined,
  onCommit: (value: KnobValue) => void,
): RefCallback<HTMLInputElement> {
  const latest = useRef({ read, onCommit });
  useEffect(() => {
    latest.current = { read, onCommit };
  });
  return useCallback((input: HTMLInputElement | null) => {
    if (input === null) return undefined;
    const settled = () => {
      const value = latest.current.read(input);
      if (value !== undefined) latest.current.onCommit(value);
    };
    input.addEventListener("change", settled);
    return () => input.removeEventListener("change", settled);
  }, []);
}

/** What a seed's field says: empty, a new one each load; a whole number, that one; else nothing it accepts. */
function typedSeed(input: HTMLInputElement): KnobValue | undefined {
  const typed = input.value.trim();
  const n = Number(typed);
  if (typed === "") return null;
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/** A knob's row: its label, naming the control `id`, then the control. */
function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="min-w-0 flex-1 truncate text-foreground/55">
        {label}
      </label>
      {children}
    </div>
  );
}

function NumberControl({ id, knob, value, onChange, onCommit }: ControlProps<NumberKnob>) {
  const current = typeof value === "number" ? value : knob.default;
  const settled = useSettled((input) => Number(input.value), onCommit);
  return (
    <>
      <input
        ref={settled}
        id={id}
        type="range"
        className="w-28 accent-primary"
        min={knob.min}
        max={knob.max}
        step={knob.step}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-12 text-right tabular-nums text-foreground/45">
        {current}
        {knob.unit ?? ""}
      </span>
    </>
  );
}

function ColorControl({ id, knob, value, onChange, onCommit }: ControlProps<ColorKnob>) {
  const current = typeof value === "string" && KNOB_COLOR.test(value) ? value : knob.default;
  const settled = useSettled((input) => input.value, onCommit);
  return (
    <>
      <input
        ref={settled}
        id={id}
        type="color"
        className="h-5 w-8 cursor-pointer rounded-sm border border-foreground/15 bg-transparent"
        value={current}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="w-16 text-right font-mono text-label text-foreground/45">{current}</span>
    </>
  );
}

/** A seed: a whole number pins it, empty draws a new one each load, the die draws one now. */
function SeedControl({ id, knob, value, onChange, onCommit }: ControlProps<SeedKnob>) {
  const current = typeof value === "number" ? value : null;
  const settled = useSettled(typedSeed, onCommit);
  return (
    <>
      <input
        ref={settled}
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        placeholder="each load"
        aria-describedby={`${id}-hint`}
        className="w-24 rounded-sm border border-foreground/15 bg-transparent px-1.5 text-right tabular-nums text-foreground/70 outline-none focus-visible:border-primary"
        value={current ?? ""}
        onChange={(e) => {
          const typed = typedSeed(e.target);
          if (typed !== undefined) onChange(typed);
        }}
      />
      <button
        type="button"
        className="rounded-sm px-1 text-foreground/50 hover:text-foreground/80 focus-visible:outline focus-visible:outline-primary"
        aria-label={`${knob.label}: draw a new one`}
        onClick={() => {
          const drawn = Math.floor(Math.random() * 2 ** 31);
          onChange(drawn);
          onCommit(drawn);
        }}
      >
        <DiceFiveIcon size={14} aria-hidden="true" />
      </button>
      <span id={`${id}-hint`} className="sr-only">
        Empty draws a new one each load
      </span>
    </>
  );
}

function Control(props: ControlProps<Knob>) {
  const { id, knob, value, onChange, onCommit } = props;
  // A choice is settled as it is made.
  const chosen = (next: KnobValue) => {
    onChange(next);
    onCommit(next);
  };
  switch (knob.kind) {
    case "number":
      return <NumberControl {...props} knob={knob} />;
    case "boolean":
      return (
        <input
          id={id}
          type="checkbox"
          className="accent-primary"
          checked={typeof value === "boolean" ? value : knob.default}
          onChange={(e) => chosen(e.target.checked)}
        />
      );
    case "enum":
      return (
        <EnumSelect
          className="rounded-sm bg-transparent text-foreground/70 outline-none"
          value={typeof value === "string" ? value : knob.default}
          options={knob.options.map((option) => ({ value: option.id, label: option.label }))}
          onChange={chosen}
          testId={id}
          id={id}
        />
      );
    case "color":
      return <ColorControl {...props} knob={knob} />;
    case "seed":
    default:
      return <SeedControl {...props} knob={knob} />;
  }
}

/** A settled value nobody keeps. */
const UNKEPT = (): void => undefined;

export function KnobControl({
  knob,
  value,
  onChange,
  onCommit = UNKEPT,
}: {
  readonly knob: Knob;
  /** The knob's value now; none, its default. */
  readonly value: KnobValue | undefined;
  /** Each move, every step of a drag. */
  readonly onChange: (value: KnobValue) => void;
  /** The value it settles on: once per gesture. */
  readonly onCommit?: (value: KnobValue) => void;
}) {
  const id = useId();
  return (
    <Row id={id} label={knob.label}>
      <Control id={id} knob={knob} value={value} onChange={onChange} onCommit={onCommit} />
    </Row>
  );
}
