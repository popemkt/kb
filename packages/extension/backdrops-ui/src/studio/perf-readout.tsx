/**
 * The studio's perf readout: what the scene's own frame meter reported on
 * its canvas (`readFrameMeter`), against the budget its contribution
 * declares (`Backdrop.budget`). A backdrop no frame meter meters (a CSS
 * wash, a vendor runtime) says so.
 */
import { useEffect, useState } from "react";
import { cn, readFrameMeter, type BackdropBudget, type FrameMeterReading } from "@kb/ui-sdk";
import { budgetWarning } from "./budget-warning";

/** How often the readout reads the meter: the meter itself reports over a window, not per frame. */
const READ_MS = 500;

function useMeter(frame: HTMLElement | null): FrameMeterReading {
  const [metered, setMetered] = useState(() => readFrameMeter(null));
  useEffect(() => {
    const read = () =>
      setMetered((before) => {
        const next = readFrameMeter(frame);
        const same =
          next.backend === before.backend &&
          next.spent === before.spent &&
          next.quality === before.quality &&
          next.floor === before.floor &&
          next.metered === before.metered;
        return same ? before : next;
      });
    read();
    const timer = window.setInterval(read, READ_MS);
    return () => window.clearInterval(timer);
  }, [frame]);
  return metered;
}

export function PerfReadout({
  frame,
  budget,
}: {
  readonly frame: HTMLElement | null;
  readonly budget: BackdropBudget;
}) {
  const reading = useMeter(frame);
  const { backend, spent, quality, metered } = reading;
  const warning = budgetWarning(reading, budget);
  return (
    <p
      className="flex items-center gap-2 text-label tabular-nums text-foreground/45"
      data-perf-readout=""
    >
      {backend === null ? null : <span>{backend}</span>}
      <span className={cn(warning !== null && "text-destructive")}>
        {metered
          ? `${spent === null ? "–" : spent.toFixed(1)} / ${budget.frameMs} ms`
          : `${budget.frameMs} ms budget, not metered`}
      </span>
      {quality === null ? null : <span>quality {quality.toFixed(2)}</span>}
      {warning === null ? null : (
        <span className="text-destructive" role="status" data-perf-warning="">
          {warning}
        </span>
      )}
    </p>
  );
}
