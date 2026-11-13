import { backdropOptionId } from "@kb/appearance";
import type { Page } from "playwright/test";
import { expect } from "./harness-test.ts";

/** The page head's frame of the backdrop it shows, not of one it is leaving. */
const SHOWN = '.kb-header-backdrop-space [data-backdrop-layer="shown"] .kb-header-backdrop';

/**
 * Whether the page head draws the backdrop `option` (its option node's id)
 * through the GPU host, once the head shows that backdrop. The GPU host's
 * element is in the frame from the frame's first render, `loading` while
 * the host's chunk loads (`backdrops-ui`'s `gpu/host-element.tsx`), so the
 * frame and its host are read in one snapshot and nothing waits on a
 * timeout. A backdrop whose frame never shows fails here, rather than
 * passing as one the GPU host does not draw.
 */
export async function drawnByGpuHost(page: Page, option: string): Promise<boolean> {
  let gpuHost = false;
  await expect
    .poll(
      async () => {
        const shown = await page.evaluate((selector) => {
          const frame = document.querySelector(selector);
          return frame === null
            ? null
            : {
                id: frame.getAttribute("data-backdrop"),
                gpuHost: frame.querySelector(".kb-gpu-backdrop") !== null,
              };
        }, SHOWN);
        gpuHost = shown?.gpuHost ?? false;
        return shown?.id === null || shown?.id === undefined ? null : backdropOptionId(shown.id);
      },
      { message: `the head shows ${option}`, timeout: 20_000 },
    )
    .toBe(option);
  return gpuHost;
}
