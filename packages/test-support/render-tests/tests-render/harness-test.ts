/**
 * The one `test` every render spec imports: Playwright's, plus a fresh
 * fixture store per test (`harness`) that `baseURL` points at, so
 * `page.goto("/graph")` always lands on a store no earlier test has written
 * to, and the GPU facts a spec may depend on (`gpu`). Each worker's
 * harnesses come from its pool (`harnessPool`), which starts the next one
 * while a test runs.
 */
import { test as base, expect, type Locator } from "playwright/test";
import { HarnessPool, type HarnessOptions } from "./harness-server.ts";

export { expect };

type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

/**
 * An element's box once it has stopped moving: two samples in a row that
 * agree. Waiting on the animations alone races the click that starts them —
 * a motion React has not committed yet has no animation to wait on.
 */
export async function settledBox(locator: Locator): Promise<Box> {
  const last: { box: Box | null; key: string } = { box: null, key: "" };
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        const key = JSON.stringify(box);
        const still = box !== null && key === last.key;
        last.box = box;
        last.key = key;
        return still;
      },
      { intervals: [100, 250] },
    )
    .toBe(true);
  if (last.box === null) throw new Error("the element has no box");
  return last.box;
}

export interface GpuFacts {
  /** Chromium handed out a WebGPU adapter on this machine. */
  readonly webgpu: boolean;
  /**
   * The backend the scene kit must report here, spelled the way the UI
   * reports it (`SceneBackend` in `ui/src/scene/backend.ts`, which a
   * test-support package cannot import). With an adapter it is WebGPU, so a
   * silent fall back to WebGL2 is red, not a pass.
   */
  readonly backend: "WebGPU" | "WebGL2";
}

/**
 * Where a test's time goes, printed one line per test when
 * `KB_RENDER_TIMING=1` (docs/ci.md → Render timing): how long it waited for its
 * harness, how long that harness took to boot (it booted while an earlier
 * test ran, so the boot is not the wait), the first `page.goto`, and the rest
 * of the test.
 */
interface TestTiming {
  harnessWaitMs: number;
  harnessBootMs: number;
  gotoMs: number;
}

export const test = base.extend<
  {
    harness: { url: string };
    timing: TestTiming;
    reportTiming: void;
    gpu: GpuFacts;
    /** What the harness installs beside the fixture store; a spec sets it with `test.use`. */
    harnessOptions: HarnessOptions;
  },
  { harnessPool: HarnessPool }
>({
  harnessOptions: [{}, { option: true }],
  harnessPool: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; the pool has none
    async ({}, provide) => {
      const pool = new HarnessPool();
      try {
        await provide(pool);
      } finally {
        await pool.close();
      }
    },
    { scope: "worker" },
  ],
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; the timing has none
  timing: async ({}, provide) => {
    await provide({ harnessWaitMs: 0, harnessBootMs: 0, gotoMs: 0 });
  },
  harness: async ({ harnessOptions, harnessPool, timing }, provide) => {
    const asked = performance.now();
    const harness = await harnessPool.take(harnessOptions);
    timing.harnessWaitMs = Math.round(performance.now() - asked);
    timing.harnessBootMs = harness.bootMs;
    try {
      await provide({ url: harness.url });
    } finally {
      await harness.stop();
    }
  },
  baseURL: async ({ harness }, provide) => {
    await provide(harness.url);
  },
  // A test's tab is the page: it opens once at the harness's URL.
  page: async ({ page, harness, timing }, provide) => {
    const asked = performance.now();
    await page.goto(harness.url);
    timing.gotoMs = Math.round(performance.now() - asked);
    await provide(page);
  },
  reportTiming: [
    async ({ timing }, provide, testInfo) => {
      await provide();
      if (process.env["KB_RENDER_TIMING"] !== "1") return;
      const rest = testInfo.duration - timing.harnessWaitMs - timing.gotoMs;
      console.log(
        `[timing] ${testInfo.file.split("/").pop()} › ${testInfo.title.slice(0, 70)} ` +
          `wait=${timing.harnessWaitMs} boot=${timing.harnessBootMs} goto=${timing.gotoMs} test=${rest}`,
      );
    },
    { auto: true },
  ],
  gpu: async ({ context, harness }, provide) => {
    // `navigator.gpu` exists only in a secure context; the harness origin
    // (127.0.0.1) is one, about:blank is not.
    const probe = await context.newPage();
    await probe.goto(`${harness.url}/api/graph`);
    const webgpu = await probe.evaluate(async () => {
      // Typed as always present; a browser without WebGPU has no `gpu` at all.
      const gpu = (navigator as { gpu?: GPU }).gpu;
      return gpu !== undefined && (await gpu.requestAdapter()) !== null;
    });
    await probe.close();
    await provide({ webgpu, backend: webgpu ? "WebGPU" : "WebGL2" });
  },
});
