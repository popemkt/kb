import { describe, expect, it, vi } from "vitest";
import { RetryableError } from "./kept-load";
import { type BuildEnv, isMissingChunk, reloadForNewBuild, watchForNewBuild } from "./stale-build";

const missing = (url = "https://kb/static/composer-page-CSoHrcCV.js") =>
  new TypeError(`Failed to fetch dynamically imported module: ${url}`);

/** Vite's event for a dynamic import, or a stylesheet of one, that failed. */
const preloadError = (payload: unknown) =>
  Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload });

/** A tab: its build, its session storage (kept across its reloads), and how often it reloaded. */
function tab(build: string, storage = new Map<string, string>()) {
  const reloads: string[] = [];
  const env: BuildEnv = {
    build,
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
    },
    reload: () => reloads.push(build),
  };
  return { env, storage, reloads };
}

describe("a tab left open across a release", () => {
  it("knows each browser's words for a chunk that did not arrive, through a retryable load's cause", () => {
    expect(isMissingChunk(missing())).toBe(true);
    expect(isMissingChunk(new TypeError("error loading dynamically imported module: x"))).toBe(
      true,
    );
    expect(isMissingChunk(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isMissingChunk(new Error("Unable to preload CSS for /static/a.css"))).toBe(true);
    expect(isMissingChunk(new RetryableError(missing(), () => {}))).toBe(true);
    expect(isMissingChunk(new Error("webgl kaboom"))).toBe(false);
    expect(isMissingChunk("Failed to fetch dynamically imported module")).toBe(false);
  });

  it("reloads once into the new build, and a reload that lands on the same build shows the failure", async () => {
    const old = tab("/static/index-old.js");
    expect(reloadForNewBuild(missing(), old.env)).toBe(true);
    expect(old.reloads).toHaveLength(1);
    // While that reload is underway, every other failure waits on it.
    expect(reloadForNewBuild(missing("https://kb/static/graph-page-x.js"), old.env)).toBe(true);
    expect(old.reloads).toHaveLength(1);

    // The reload is a new page, with the tab's storage. It came back to the
    // same build: the chunk is missing for another reason, and it is shown
    // rather than reloaded forever.
    vi.resetModules();
    const reloaded = await import("./stale-build");
    const same = tab("/static/index-old.js", old.storage);
    expect(reloaded.reloadForNewBuild(missing(), same.env)).toBe(false);
    expect(same.reloads).toHaveLength(0);

    // A later release, in the same tab, reloads again.
    const next = tab("/static/index-next.js", old.storage);
    expect(reloaded.reloadForNewBuild(missing(), next.env)).toBe(true);
    expect(next.reloads).toHaveLength(1);
  });

  it("leaves any other failure alone", () => {
    const t = tab("/static/index-a.js");
    expect(reloadForNewBuild(new Error("webgl kaboom"), t.env)).toBe(false);
    expect(t.reloads).toHaveLength(0);
  });

  it("shows the failure when storage refuses, since a reload it cannot record could loop", () => {
    const t = tab("/static/index-b.js");
    const refusing: BuildEnv = {
      ...t.env,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    };
    expect(reloadForNewBuild(missing(), refusing)).toBe(false);
    expect(t.reloads).toHaveLength(0);
  });

  it("reloads for Vite's failed preload, until unsubscribed", () => {
    const target = new EventTarget();
    const t = tab("/static/index-c.js");
    const stop = watchForNewBuild(target, t.env);

    target.dispatchEvent(preloadError(new Error("webgl kaboom")));
    expect(t.reloads).toHaveLength(0);
    const event = preloadError(missing());
    target.dispatchEvent(event);
    expect(t.reloads).toHaveLength(1);
    // The failure still reaches its import, which the boundary shows as an update.
    expect(event.defaultPrevented).toBe(false);

    stop();
    const unwatched = tab("/static/index-d.js");
    watchForNewBuild(target, unwatched.env)();
    target.dispatchEvent(preloadError(missing()));
    expect(unwatched.reloads).toHaveLength(0);
  });
});
