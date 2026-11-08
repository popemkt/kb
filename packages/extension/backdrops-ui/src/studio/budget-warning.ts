/**
 * What the studio's perf readout warns of (DESIGN-UI.md → Backdrop Studio →
 * the perf readout): a scene over its budget, in words, not in colour alone.
 */
import type { BackdropBudget, FrameMeterReading } from "@kb/ui-sdk";

/**
 * The warning a reading over `budget` earns, in words: over budget, and at
 * its lowest quality once its meter has nothing left to step down; null
 * within budget or before the meter has reported.
 */
export function budgetWarning(
  { spent, quality, floor }: FrameMeterReading,
  budget: BackdropBudget,
): string | null {
  if (spent === null || spent <= budget.frameMs) return null;
  return quality !== null && floor !== null && quality <= floor
    ? "over budget at its lowest quality"
    : "over budget";
}
