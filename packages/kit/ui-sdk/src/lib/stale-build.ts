/**
 * A tab that outlived its build (DESIGN-UI.md → Delivery, "A tab outlives
 * its build"). A release replaces `ui/dist`, and the server keeps serving
 * the chunks of the builds before it, so a tab of an earlier build keeps
 * working. It reloads only when it cannot: the server speaks another wire
 * protocol, or a chunk it asks for is gone even so. This module alone
 * decides when the tab goes to the new build.
 *
 * - **The rule: the server says which protocol it speaks.** Every
 *   connection's `hello` names it ({@link followServerProtocol}). A tab of
 *   another protocol reloads.
 * - **The fallback: a chunk that did not arrive.** Vite's
 *   `vite:preloadError`, which every dynamic import of the bundle raises
 *   ({@link watchForNewBuild}), and a view's error boundary, which asks
 *   ({@link reloadForNewBuild}) before it shows a crash.
 *
 * Either way the reload waits until the page is idle — nothing it holds
 * would be lost — and the page writes down what it comes back to (the
 * route, where each pane is scrolled, the caret) before it goes, saying so
 * meanwhile (`announce`). What idle, carrying and announcing mean is the
 * shell's to say; this module only orders them.
 *
 * Both reload through one guard: once per build. A build is the `src` of
 * the module script the page's `index.html` loads. The tab's session
 * storage records the build it reloaded for, so a reload that lands on the
 * same build asks the person instead of reloading again (`stuck`). A page
 * that is no build (the dev server's) follows none.
 */
import { WIRE_PROTOCOL } from "@kb/contracts";

/**
 * Where a reload the page needs stands: none needed, `waiting` for the page
 * to be idle, `reloading`, or `stuck` — reloading again would land on this
 * same build, so the person is asked.
 */
export type ReloadState = "none" | "waiting" | "reloading" | "stuck";

/** What reloading for a new build reads and does; the page's, once the shell installs it. */
export interface BuildEnv {
  /** The build this page was served by; null for a page that is no build. */
  readonly build: string | null;
  readonly storage: Pick<Storage, "getItem" | "setItem">;
  readonly reload: () => void;
  /** Resolves once a reload would lose nothing the page holds. */
  readonly idle: () => Promise<void>;
  /** Write down what the page comes back to after the reload. */
  readonly carry: () => void;
  /** Tell the person where a reload stands. */
  readonly announce: (state: ReloadState) => void;
}

const RELOADED_FOR = "kb.reloaded-for-build";

/** The build a reload is under way for in this page, which every later need joins. */
let pending: string | null = null;

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
  idle: () => Promise.resolve(),
  carry: () => {},
  announce: () => {},
};

/**
 * The page's own build, its entry module script as `index.html` names it,
 * reloaded at once with nothing carried: what the shell builds its own on.
 */
export function browserBuildEnv(): BuildEnv {
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return {
    ...NO_PAGE,
    build: entry?.getAttribute("src") ?? null,
    storage: sessionStorage,
    reload: () => location.reload(),
  };
}

/** The page whose build is followed: none until the shell of a built page installs it. */
let page: BuildEnv = NO_PAGE;

/** Go now: record the build gone from, carry what the page comes back to, reload. */
export function reloadNow(env: BuildEnv = page): void {
  try {
    if (env.build !== null) env.storage.setItem(RELOADED_FOR, env.build);
  } catch {
    // Storage refused: the person asked, so the reload goes unrecorded.
  }
  env.announce("reloading");
  env.carry();
  env.reload();
}

/**
 * The one guard: reload once the page is idle, unless this build was
 * reloaded for already, or storage cannot say whether it was — then the
 * person is asked. True while a reload is under way.
 */
function reloadWhenIdle(env: BuildEnv): boolean {
  const { build } = env;
  if (build === null) return false;
  if (pending === build) return true;
  try {
    if (env.storage.getItem(RELOADED_FOR) === build) {
      env.announce("stuck");
      return false;
    }
  } catch {
    // Storage refused (private mode, quota): without the record a reload
    // could loop, so the person is asked instead.
    env.announce("stuck");
    return false;
  }
  pending = build;
  env.announce("waiting");
  void env.idle().then(() => {
    if (pending === build && page === env) reloadNow(env);
  });
  return true;
}

/**
 * What the tab does about the protocol a connection's `hello` names: a
 * server of this page's protocol, whatever its build, is followed as it is;
 * one of another protocol is reloaded into once the page is idle.
 */
export function followServerProtocol(served: number | undefined, env: BuildEnv = page): void {
  if (served === undefined || env.build === null || served === WIRE_PROTOCOL) return;
  reloadWhenIdle(env);
}

/**
 * Reloads the page, once it is idle, when `error` is a missing chunk and
 * this build has not been reloaded for yet; true when it will, so the
 * caller shows that the page is being updated rather than that it crashed.
 */
export function reloadForNewBuild(error: unknown, env: BuildEnv = page): boolean {
  return isMissingChunk(error) && reloadWhenIdle(env);
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
  env: BuildEnv = browserBuildEnv(),
): () => void {
  page = env;
  pending = null;
  const onPreloadError = (event: Event): void => {
    reloadForNewBuild((event as Event & { payload?: unknown }).payload, env);
  };
  target.addEventListener("vite:preloadError", onPreloadError);
  return () => {
    target.removeEventListener("vite:preloadError", onPreloadError);
    if (page === env) page = NO_PAGE;
  };
}
