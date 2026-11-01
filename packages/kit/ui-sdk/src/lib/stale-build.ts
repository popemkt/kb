/**
 * A tab that outlived its build (DESIGN-UI.md → Delivery, "A tab outlives
 * its build"). A release replaces `ui/dist`, so the chunks an open tab was
 * built against are gone. The only cure is the new build's page, and this
 * module alone decides when the tab goes there.
 *
 * - **The rule: the server says which build it serves.** Every connection's
 *   `hello` names it ({@link followServerBuild}). A tab of another build
 *   reloads. With unsaved edits it offers to reload instead, because a
 *   reload would drop them.
 * - **The fallback: a chunk that did not arrive.** Some failures come before
 *   any hello says so: Vite's `vite:preloadError`, which every dynamic import
 *   of the bundle raises ({@link watchForNewBuild}, installed by the shell),
 *   and a view's error boundary, which asks ({@link reloadForNewBuild})
 *   before it shows a crash.
 *
 * The shell of a built page installs it ({@link watchForNewBuild}); a page
 * that is no build (the dev server's) installs nothing and follows none.
 * Both reload through one guard: once per build. A build is the `src` of
 * the module script the page's `index.html` loads, whose digest changes
 * whenever any chunk it may fetch is renamed; the server names its own the
 * same way. The tab's session storage records the build it reloaded for, so
 * a reload that lands on the same build shows what is wrong rather than
 * reloading again.
 */

/** What reloading for a new build reads and does; the page's, once the shell installs it. */
export interface BuildEnv {
  /** The build this page was served by; null for a page that is no build. */
  readonly build: string | null;
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

/** No built page (a test, the dev server's page): nothing to follow, nothing to reload. */
const NO_PAGE: BuildEnv = {
  build: null,
  storage: { getItem: () => null, setItem: () => {} },
  reload: () => {},
};

/** The page's own build, its entry module script as `index.html` names it. */
function browserEnv(): BuildEnv {
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return {
    build: entry?.getAttribute("src") ?? null,
    storage: sessionStorage,
    reload: () => location.reload(),
  };
}

/** The page whose build is followed: none until the shell of a built page installs it. */
let page: BuildEnv = NO_PAGE;

/**
 * The one guard: reload unless this build was reloaded for already, or
 * storage cannot record that it was. True when the page is reloading.
 */
function reloadOnce(env: BuildEnv): boolean {
  const { build } = env;
  if (build === null) return false;
  if (reloading === build) return true;
  try {
    if (env.storage.getItem(RELOADED_FOR) === build) return false;
    env.storage.setItem(RELOADED_FOR, build);
  } catch {
    // Storage refused (private mode, quota): without the record a reload
    // could loop, so what is wrong is shown instead.
    return false;
  }
  reloading = build;
  env.reload();
  return true;
}

/**
 * What the tab does about the build a connection's `hello` names:
 * - `current`: it is this page's, or either side names none;
 * - `reloading`: the page is going to it;
 * - `offer`: the person is offered the reload, either because `unsaved`
 *   edits would be lost or because this build was reloaded for already.
 */
export type BuildFollowing = "current" | "reloading" | "offer";

export function followServerBuild(
  served: string | undefined,
  unsaved: boolean,
  env: BuildEnv = page,
): BuildFollowing {
  if (served === undefined || env.build === null || served === env.build) return "current";
  if (unsaved) return "offer";
  return reloadOnce(env) ? "reloading" : "offer";
}

/**
 * Reloads the page when `error` is a missing chunk and this build has not
 * been reloaded for yet; true when it does, so the caller shows that the
 * page is being updated rather than that it crashed.
 */
export function reloadForNewBuild(error: unknown, env: BuildEnv = page): boolean {
  return isMissingChunk(error) && reloadOnce(env);
}

/**
 * Follow this page's build: what the shell of a built page installs, once.
 * From then on a hello and a view's boundary decide for `env`, and Vite's
 * failed preloads on `target` reload for it. Returns the uninstall. A
 * preload's failure still reaches its import: a page waiting on it sees why
 * it did not arrive, and its boundary says the page is being updated.
 */
export function watchForNewBuild(
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  env: BuildEnv = browserEnv(),
): () => void {
  page = env;
  const onPreloadError = (event: Event): void => {
    reloadForNewBuild((event as Event & { payload?: unknown }).payload, env);
  };
  target.addEventListener("vite:preloadError", onPreloadError);
  return () => {
    target.removeEventListener("vite:preloadError", onPreloadError);
    if (page === env) page = NO_PAGE;
  };
}
