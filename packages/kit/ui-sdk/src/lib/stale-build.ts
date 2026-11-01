/**
 * A tab that outlived its build. A release replaces `ui/dist`, so the chunks
 * an open tab was built against are gone, and every page it has not loaded
 * yet fails to arrive ("Failed to fetch dynamically imported module …"). The
 * only cure is the new build's page, so the tab reloads, once per build: the
 * build is the page's entry script, whose digest changes whenever any chunk
 * it may fetch is renamed. A reload that lands on the same build (the
 * failure was not a release) records it, and the next failure is shown
 * rather than reloaded again (DESIGN-UI.md → Delivery, "A tab outlives its
 * build").
 *
 * Two signals reach it: Vite's `vite:preloadError`, which every dynamic
 * import of the bundle raises ({@link watchForNewBuild}, installed by the
 * shell), and a view's error boundary, which asks before it shows a crash.
 */

/** What reloading for a new build reads and does; the browser's by default. */
export interface BuildEnv {
  /** The build this page was served by. */
  readonly build: string;
  readonly storage: Pick<Storage, "getItem" | "setItem">;
  readonly reload: () => void;
}

const RELOADED_FOR = "kb.reloaded-for-build";

/** The build a reload has been started for in this page, which every later failure waits on. */
let reloading: string | null = null;

/** Each browser's words for a module, or a chunk's stylesheet, that did not arrive. */
const CHUNK_MISSING = [
  "Failed to fetch dynamically imported module", // Chromium
  "error loading dynamically imported module", // Firefox
  "Importing a module script failed", // WebKit
  "Unable to preload CSS", // Vite's preload of a chunk's stylesheet
];

/** Whether `error`, or anything it was caused by, is a chunk that did not arrive. */
export function isMissingChunk(error: unknown): boolean {
  for (let at = error, depth = 0; at instanceof Error && depth < 8; at = at.cause, depth++)
    if (CHUNK_MISSING.some((words) => at.message.includes(words))) return true;
  return false;
}

function browserEnv(): BuildEnv {
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return {
    build: entry?.src ?? location.pathname,
    storage: sessionStorage,
    reload: () => location.reload(),
  };
}

/**
 * Reloads the page when `error` is a missing chunk and this build has not
 * been reloaded for yet; true when it does, so the caller shows that the
 * page is being updated rather than that it crashed.
 */
export function reloadForNewBuild(error: unknown, env: BuildEnv = browserEnv()): boolean {
  if (!isMissingChunk(error)) return false;
  if (reloading === env.build) return true;
  try {
    if (env.storage.getItem(RELOADED_FOR) === env.build) return false;
    env.storage.setItem(RELOADED_FOR, env.build);
  } catch {
    // Storage refused (private mode, quota): without the record a reload
    // could loop, so the failure is shown instead.
    return false;
  }
  reloading = env.build;
  env.reload();
  return true;
}

/**
 * Listens for Vite's failed preloads on `target` and reloads for them;
 * returns the unsubscribe. The failure still reaches its import: a page
 * waiting on it sees why it did not arrive, and its boundary says the page
 * is being updated.
 */
export function watchForNewBuild(
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  env?: BuildEnv,
): () => void {
  const onPreloadError = (event: Event): void => {
    reloadForNewBuild((event as Event & { payload?: unknown }).payload, env);
  };
  target.addEventListener("vite:preloadError", onPreloadError);
  return () => target.removeEventListener("vite:preloadError", onPreloadError);
}
