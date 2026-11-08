import type { PointerSource } from "@kb/ui-sdk";

/** The self-hosted Unicorn Studio runtime, shared by every header scene. */
export interface UnicornScene {
  paused: boolean;
  /** The runtime's own cursor following, read each frame: `disabled` holds the cursor still. */
  readonly interactivity: { readonly mouse: { disabled: boolean } };
  destroy: () => void;
}

interface UnicornRuntime {
  addScene: (options: {
    element: HTMLElement;
    filePath: string;
    fps: number;
    dpi: number;
    scale: number;
    lazyLoad: boolean;
    interactivity: { mouse: { disabled: boolean } };
  }) => Promise<UnicornScene>;
}

declare global {
  interface Window {
    UnicornStudio?: UnicornRuntime;
  }
}

let runtime: Promise<UnicornRuntime> | null = null;

function loadRuntime(): Promise<UnicornRuntime> {
  if (window.UnicornStudio) return Promise.resolve(window.UnicornStudio);
  runtime ??= new Promise<UnicornRuntime>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/unicorn/unicornStudio-2.1.12.umd.js";
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        const loaded = window.UnicornStudio;
        if (loaded) resolve(loaded);
        else reject(new Error("Unicorn Studio runtime did not initialize"));
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        script.remove();
        reject(new Error("Unicorn Studio runtime could not be loaded"));
      },
      { once: true },
    );
    document.head.append(script);
  }).catch((error: unknown) => {
    runtime = null;
    throw error;
  });
  return runtime;
}

export async function createUnicornScene(
  element: HTMLElement,
  signal: AbortSignal,
): Promise<UnicornScene> {
  const loaded = await loadRuntime();
  signal.throwIfAborted();
  return loaded.addScene({
    element,
    filePath: "/vendor/unicorn/scene.json",
    fps: 60,
    dpi: 1.5,
    scale: 1,
    lazyLoad: false,
    // Still until the pointer source says the pointer is over its frame (`followPointer`).
    interactivity: { mouse: { disabled: true } },
  });
}

/**
 * Hold the scene's cursor following to `pointer`, the one the page hands
 * the backdrop: it follows only while the pointer source says the pointer
 * is over its frame, so a source with no pointer (Backdrop Studio outside
 * Interact) keeps it still. Where the cursor lands is still the runtime's
 * own reading of the window, in screen pixels: GAP [[01M6XGS4KEXS9321E2JXHRYRK5]].
 */
export function followPointer(scene: Pick<UnicornScene, "interactivity">, pointer: PointerSource) {
  scene.interactivity.mouse.disabled = pointer.now() === null;
}
