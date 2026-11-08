/**
 * The one info card every study shows (Lab principles P4): the technique,
 * what it teaches, the principles it applies (by id; their text lives once,
 * in DESIGN-UI.md → Lab principles), and its live parameters.
 */
import { useState } from "react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import type { KnobValue, KnobValues } from "@kb/model";
import { KnobControl } from "@kb/ui-sdk";
import type { LabStudy } from "./contract";

export function InfoCard({
  study,
  values,
  onChange,
}: {
  study: LabStudy;
  values: KnobValues;
  onChange: (id: string, value: KnobValue) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section
      aria-label={`${study.label}: how it works`}
      className="pointer-events-auto w-80 rounded-lg border border-foreground/10 bg-popover/85 text-meta shadow-floating backdrop-blur-md"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/80">
          {study.technique}
        </span>
        {open ? <CaretDownIcon size={12} /> : <CaretUpIcon size={12} />}
      </button>
      {open ? (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <p className="leading-relaxed text-foreground/60">{study.teaches}</p>
          <ul className="flex flex-col gap-1">
            {study.rules.map((rule) => (
              <li key={rule.id} className="flex gap-2 leading-snug text-foreground/55">
                <span className="w-6 shrink-0 font-mono text-label text-primary">{rule.id}</span>
                <span>{rule.how}</span>
              </li>
            ))}
          </ul>
          {study.controls.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t border-foreground/[0.06] pt-2.5">
              {study.controls.map((control) => (
                <KnobControl
                  key={control.id}
                  knob={control}
                  value={values[control.id]}
                  onChange={(value) => onChange(control.id, value)}
                />
              ))}
            </div>
          ) : null}
          <p className="text-label text-foreground/35">Principles: DESIGN-UI.md → Lab principles</p>
        </div>
      ) : null}
    </section>
  );
}
