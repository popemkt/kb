/**
 * The frame-cost meter every animated backdrop holds its cost with: the 2D
 * stage (`stage.ts`) over the main thread's time, a GPU scene over the GPU's
 * (`gpu/gpu-scene.ts`). Over budget for long enough, it says to lower detail,
 * so the scene pays for a busy page and the page does not pay for the scene.
 */

/**
 * A smoothed cost per frame (ms), and a verdict every 30 frames on whether
 * it has run over budget long enough to lower detail.
 */
export function meterOf(budgetMs: number) {
  let spent = 0;
  let frames = 0;
  let over = 0;
  return {
    /** Record one frame's cost; the smoothed cost when a verdict is due, else null. */
    record: (ms: number): { spent: number; lower: boolean } | null => {
      spent = spent === 0 ? ms : spent * 0.94 + ms * 0.06;
      frames++;
      if (frames % 30 !== 0) return null;
      over = spent > budgetMs ? over + 1 : 0;
      const lower = over >= 3;
      if (lower) over = 0;
      return { spent, lower };
    },
  };
}
