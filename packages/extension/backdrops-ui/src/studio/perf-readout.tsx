/**
 * The studio's perf readout: what the scene's own frame meter reported on
 * its canvas (`readFrameMeter`), against the budget its contribution
 * declares (`Backdrop.budget`). A backdrop no frame meter meters (a CSS
 * wash, a vendor runtime) says so.
 */
import { useEffect, useState } from "react";
import { cn, readFrameMeter, type BackdropBudget, type FrameMeterReading } from "@kb/ui-sdk";

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
  const { backend, spent, quality, metered } = useMeter(frame);
  const over = spent !== null && spent > budget.frameMs;
  return (
    <p
      className="flex items-center gap-2 text-label tabular-nums text-foreground/45"
      data-perf-readout=""
    >
      {backend === null ? null : <span>{backend}</span>}
      <span className={cn(over && "text-destructive")}>
        {metered
          ? `${spent === null ? "–" : spent.toFixed(1)} / ${budget.frameMs} ms`
          : `${budget.frameMs} ms budget, not metered`}
      </span>
      {quality === null ? null : <span>quality {quality.toFixed(2)}</span>}
    </p>
  );
}
