import type { PointerSource } from "@kb/appearance-kit";

/** The self-hosted Unicorn Studio runtime, shared by every header scene. */
export interface UnicornScene {
  paused: boolean;
  /** The runtime's own cursor following, read each frame: `disabled` holds the cursor still. */
  readonly interactivity: { readonly mouse: { disabled: boolean } };
  destroy: () => void;
}

/**
 * The runtime's scene as `addScene` hands it over: it resolves before the
 * scene's planes are made, and `initializing` holds until they are.
 */
interface StartingScene extends UnicornScene {
  readonly initializing?: boolean;
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
  }) => Promise<StartingScene>;
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

/**
 * The scene once the runtime has started it, looked for once a frame (the
 * runtime makes its planes in a frame too). The runtime offers no word of it,
 * and a scene destroyed sooner leaves the rest of its start reading what
 * `destroy` took, outside any promise kb holds; so a scene handed over is
 * one that can be destroyed at once.
 */
function started(scene: StartingScene): Promise<UnicornScene> {
  return new Promise((resolve) => {
    const look = () => {
      if (scene.initializing === true) requestAnimationFrame(look);
      else resolve(scene);
    };
    look();
  });
}

/**
 * A scene in `element`, resolved once the runtime has started it. Aborted
 * before the runtime has loaded, no scene is started; aborted after, the
 * caller destroys the scene it is handed.
 */
export async function createUnicornScene(
  element: HTMLElement,
  signal: AbortSignal,
): Promise<UnicornScene> {
  const loaded = await loadRuntime();
  signal.throwIfAborted();
  const scene = await loaded.addScene({
    element,
    filePath: "/vendor/unicorn/scene.json",
    fps: 60,
    dpi: 1.5,
    scale: 1,
    lazyLoad: false,
    // Still until the pointer source says the pointer is over its frame (`followPointer`).
    interactivity: { mouse: { disabled: true } },
  });
  return started(scene);
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
