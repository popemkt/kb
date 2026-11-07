/**
 * The studio's perf readout: what the scene's own meter measured, read off
 * its canvas (`data-gpu-ms` where the backend reports GPU time, else
 * `data-frame-ms`; `data-quality`; `data-backend`), against the budget its
 * contribution declares (`Backdrop.budget`). A backdrop no host meters (a
 * CSS wash, a vendor runtime) says so.
 */
import { useEffect, useState } from "react";
import { cn, type BackdropBudget } from "@kb/ui-sdk";

/** How often the readout reads the meter: the meter itself reports over a window, not per frame. */
const READ_MS = 500;

interface Metered {
  readonly backend: string | null;
  /** Milliseconds a frame spent, as the meter last reported; null, not reported yet. */
  readonly spent: number | null;
  readonly quality: number | null;
  /** Whether the frame draws to a canvas a host meters. */
  readonly metered: boolean;
}

const UNMETERED: Metered = { backend: null, spent: null, quality: null, metered: false };

const numberOf = (value: string | undefined): number | null => {
  const n = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** What the meter in `frame` last reported. */
function readMeter(frame: HTMLElement | null): Metered {
  const canvas = frame?.querySelector<HTMLCanvasElement>("canvas[data-quality]");
  if (canvas === null || canvas === undefined) return UNMETERED;
  const { backend, gpuMs, frameMs, quality } = canvas.dataset;
  return {
    backend: backend ?? null,
    spent: numberOf(gpuMs ?? frameMs),
    quality: numberOf(quality),
    metered: true,
  };
}

function useMeter(frame: HTMLElement | null): Metered {
  const [metered, setMetered] = useState<Metered>(UNMETERED);
  useEffect(() => {
    const read = () =>
      setMetered((before) => {
        const next = readMeter(frame);
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
