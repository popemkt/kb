/**
 * The one control a knob is drawn with (`@kb/model`'s `Knob`): a lab
 * study's parameters and a backdrop's knobs are the same schema, so they are
 * drawn, labelled and reached by keyboard the same way, wherever a panel
 * lists them.
 */
import { useId, type ReactNode } from "react";
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

/** What one kind's control is handed: its knob, the value now (none, its default), and where a change goes. */
interface ControlProps<K extends Knob> {
  readonly id: string;
  readonly knob: K;
  readonly value: KnobValue | undefined;
  readonly onChange: (value: KnobValue) => void;
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

function NumberControl({ id, knob, value, onChange }: ControlProps<NumberKnob>) {
  const current = typeof value === "number" ? value : knob.default;
  return (
    <>
      <input
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

function ColorControl({ id, knob, value, onChange }: ControlProps<ColorKnob>) {
  const current = typeof value === "string" && KNOB_COLOR.test(value) ? value : knob.default;
  return (
    <>
      <input
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
function SeedControl({ id, knob, value, onChange }: ControlProps<SeedKnob>) {
  const current = typeof value === "number" ? value : null;
  return (
    <>
      <input
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
          const typed = e.target.value.trim();
          const n = Number(typed);
          if (typed === "") onChange(null);
          else if (Number.isSafeInteger(n) && n >= 0) onChange(n);
        }}
      />
      <button
        type="button"
        className="rounded-sm px-1 text-foreground/50 hover:text-foreground/80 focus-visible:outline focus-visible:outline-primary"
        aria-label={`${knob.label}: draw a new one`}
        onClick={() => onChange(Math.floor(Math.random() * 2 ** 31))}
      >
        <DiceFiveIcon size={14} aria-hidden="true" />
      </button>
      <span id={`${id}-hint`} className="sr-only">
        Empty draws a new one each load
      </span>
    </>
  );
}

function Control({ id, knob, value, onChange }: ControlProps<Knob>) {
  switch (knob.kind) {
    case "number":
      return <NumberControl id={id} knob={knob} value={value} onChange={onChange} />;
    case "boolean":
      return (
        <input
          id={id}
          type="checkbox"
          className="accent-primary"
          checked={typeof value === "boolean" ? value : knob.default}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "enum":
      return (
        <EnumSelect
          className="rounded-sm bg-transparent text-foreground/70 outline-none"
          value={typeof value === "string" ? value : knob.default}
          options={knob.options.map((option) => ({ value: option.id, label: option.label }))}
          onChange={onChange}
          testId={id}
          id={id}
        />
      );
    case "color":
      return <ColorControl id={id} knob={knob} value={value} onChange={onChange} />;
    case "seed":
    default:
      return <SeedControl id={id} knob={knob} value={value} onChange={onChange} />;
  }
}

export function KnobControl({
  knob,
  value,
  onChange,
}: {
  readonly knob: Knob;
  /** The knob's value now; none, its default. */
  readonly value: KnobValue | undefined;
  readonly onChange: (value: KnobValue) => void;
}) {
  const id = useId();
  return (
    <Row id={id} label={knob.label}>
      <Control id={id} knob={knob} value={value} onChange={onChange} />
    </Row>
  );
}
