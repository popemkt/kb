/**
 * The one control a knob is drawn with (`@kb/model`'s `Knob`): a lab
 * study's parameters and a backdrop's knobs are the same schema, so they are
 * drawn, labelled and reached by keyboard the same way, wherever a panel
 * lists them.
 */
import { useId } from "react";
import type { Knob, KnobValue } from "@kb/model";
import { EnumSelect } from "./enum-select";

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
  const label = (
    <label htmlFor={id} className="min-w-0 flex-1 truncate text-foreground/55">
      {knob.label}
    </label>
  );
  switch (knob.kind) {
    case "number": {
      const current = typeof value === "number" ? value : knob.default;
      return (
        <div className="flex items-center gap-2">
          {label}
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
        </div>
      );
    }
    case "boolean":
      return (
        <div className="flex items-center gap-2">
          {label}
          <input
            id={id}
            type="checkbox"
            className="accent-primary"
            checked={typeof value === "boolean" ? value : knob.default}
            onChange={(e) => onChange(e.target.checked)}
          />
        </div>
      );
    case "enum":
      return (
        <div className="flex items-center gap-2">
          {label}
          <EnumSelect
            className="rounded-sm bg-transparent text-foreground/70 outline-none"
            value={typeof value === "string" ? value : knob.default}
            options={knob.options.map((option) => ({ value: option.id, label: option.label }))}
            onChange={onChange}
            testId={id}
          />
        </div>
      );
    default:
      return null;
  }
}
