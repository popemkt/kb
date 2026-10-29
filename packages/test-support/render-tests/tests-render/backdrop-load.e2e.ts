// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A page load shows its backdrop once (DESIGN-UI.md → Page-head backdrops →
// GPU scenes → One load, one reveal). For every contributed GPU backdrop, a
// fresh tab loads the home page with that backdrop chosen and records what
// the load did to the GPU and the page head: one adapter, one canvas never
// replaced, a context only ever configured at the frame's own size (never the
// canvas's default 300×150, a frame drawn before it had its size), no wash
// shown while it loads, the scene marked ready once and the canvas faded in
// once. A remount, a second context, a frame drawn at the wrong size or a
// placeholder before the scene is what the eye sees as a flicker on load.
import { SYSTEM_IDS, backdropOptionId } from "@kb/model";
import type { APIRequestContext, BrowserContext } from "playwright/test";
import { expect, test } from "./harness-test.ts";

/** What one load did, as the page recorded it. */
interface LoadRecord {
  readonly adapters: number;
  readonly canvases: number;
  readonly removed: number;
  readonly configures: readonly string[];
  /** The head's wash, which is a GPU backdrop's fallback only, shown during the load. */
  readonly washes: number;
  readonly ready: number;
  readonly reveals: number;
  readonly state: string | null;
}

/** Records a load's GPU requests and the page head's canvases, from the first script on. */
function recordLoad() {
  const record = {
    adapters: 0,
    canvases: 0,
    removed: 0,
    configures: [] as string[],
    washes: 0,
    ready: 0,
    reveals: 0,
  };
  Object.assign(window, { kbLoad: record });
  const opacityOf = new WeakMap<Element, string>();
  const gpu = (navigator as { gpu?: GPU }).gpu;
  if (gpu !== undefined) {
    const request = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = (...args) => {
      record.adapters += 1;
      return request(...args);
    };
  }
  // oxlint-disable-next-line typescript/unbound-method -- wrapped, and called with each canvas as `this`
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind: string,
    options?: unknown,
  ) {
    const context = getContext.call(this, kind, options) as GPUCanvasContext | null;
    if (kind === "webgpu" && context !== null) {
      const configure = context.configure.bind(context);
      context.configure = (config) => {
        record.configures.push(`${this.width}x${this.height}`);
        configure(config);
      };
    }
    return context;
  } as typeof getContext;
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const target = mutation.target as Element;
      if (mutation.type === "attributes") {
        if (mutation.attributeName === "data-scene-state") {
          if (target.getAttribute("data-scene-state") === "ready") record.ready += 1;
        } else if (target instanceof HTMLCanvasElement) {
          const opacity = target.style.opacity;
          if (opacity === "1" && opacityOf.get(target) !== "1") record.reveals += 1;
          opacityOf.set(target, opacity);
        }
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLCanvasElement && node.closest(".kb-gpu-backdrop") !== null) {
          record.canvases += 1;
        }
        if (node instanceof Element) {
          const wash = ".kb-header-backdrop-space .kb-header-tint";
          record.washes += node.matches(wash) ? 1 : node.querySelectorAll(wash).length;
        }
      }
      for (const node of mutation.removedNodes) {
        if (node instanceof HTMLCanvasElement) record.removed += 1;
      }
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-scene-state", "style"],
  });
}

async function action(request: APIRequestContext, id: string, input: Record<string, unknown>) {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = await response.json();
  expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
  return receipt;
}

/**
 * The home page loaded in a fresh tab, and what its load did once the
 * backdrop has settled; null when the backdrop is not a GPU scene.
 */
async function load(context: BrowserContext, url: string): Promise<LoadRecord | null> {
  const tab = await context.newPage();
  await tab.addInitScript(recordLoad);
  await tab.goto(url);
  const host = tab.locator(".kb-header-backdrop-space .kb-gpu-backdrop").first();
  const isGpu = await host
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!isGpu) {
    await tab.close();
    return null;
  }
  await expect(host).toHaveAttribute("data-scene-state", /ready|unavailable/, { timeout: 20_000 });
  // Long enough for anything that would remount or resize it to have done so.
  await tab.waitForTimeout(1500);
  const record = await tab.evaluate(
    () => (window as unknown as { kbLoad: Omit<LoadRecord, "state"> }).kbLoad,
  );
  const state = await host.getAttribute("data-scene-state");
  await tab.close();
  return { ...record, state };
}

test("every GPU backdrop loads once: one context, at its size, revealed once", async ({
  context,
  request,
  harness,
  gpu,
}) => {
  // Every contributed backdrop, each loaded in its own tab.
  test.setTimeout(300_000);
  // GAP [[01M3E6QH4WZFJQTQM96NBZ7VVA]]
  test.skip(!gpu.webgpu, "the load is recorded through WebGPU's own calls");
  const field = await action(request, "node.get", { id: SYSTEM_IDS.backdropField });
  const options = (field.output.node.children as ReadonlyArray<{ id: string }>).map(
    (child) => child.id,
  );
  const tried: string[] = [];
  for (const option of options) {
    await action(request, "node.update", {
      id: "sys.extension.core",
      setProps: [{ field: SYSTEM_IDS.backdropField, value: { t: "ref", v: option } }],
    });
    const record = await load(context, harness.url);
    if (record === null) continue;
    tried.push(option);
    expect.soft(record.state, option).toBe("ready");
    expect.soft(record.adapters, `${option}: GPU adapters per load`).toBe(1);
    expect.soft(record.canvases, `${option}: canvases per load`).toBe(1);
    expect.soft(record.removed, `${option}: canvases removed during the load`).toBe(0);
    expect.soft(record.configures.length, `${option}: contexts configured`).toBeGreaterThan(0);
    expect
      .soft(record.configures, `${option}: a context configured at the canvas's default size`)
      .not.toContain("300x150");
    expect.soft(record.washes, `${option}: the wash shown while it loaded`).toBe(0);
    expect.soft(record.ready, `${option}: scene marked ready`).toBe(1);
    expect.soft(record.reveals, `${option}: canvas faded in`).toBe(1);
  }
  expect(tried.length, "no GPU backdrop was tried").toBeGreaterThan(0);
  expect(tried).toContain(backdropOptionId("backdrops.lens"));
});
