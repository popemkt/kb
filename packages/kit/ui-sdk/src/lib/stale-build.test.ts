import { describe, expect, it, vi } from "vitest";
import { WIRE_PROTOCOL } from "@kb/contracts";
import { RetryableError } from "./kept-load";
import {
  type BuildEnv,
  type ReloadState,
  followServerProtocol,
  isMissingChunk,
  reloadForNewBuild,
  reloadNow,
  watchForNewBuild,
} from "./stale-build";

const missing = (url = "https://kb/static/composer-page-CSoHrcCV.js") =>
  new TypeError(`Failed to fetch dynamically imported module: ${url}`);

/** Vite's event for a dynamic import, or a stylesheet of one, that failed. */
const preloadError = (payload: unknown) =>
  Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload });

/**
 * A tab: its build, its session storage (kept across its reloads), what it
 * did, in order, and the moment it becomes idle, which the test decides.
 */
function tab(build: string | null, storage = new Map<string, string>()) {
  const did: string[] = [];
  const announced: ReloadState[] = [];
  const idle = Promise.withResolvers<void>();
  const env: BuildEnv = {
    build,
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
    },
    reload: () => did.push("reload"),
    idle: () => idle.promise,
    carry: () => did.push("carry"),
    announce: (state) => announced.push(state),
  };
  const stop = watchForNewBuild(new EventTarget(), env);
  return { env, storage, did, announced, becomeIdle: () => idle.resolve(), stop };
}

/** Let the idle promise's continuation run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the protocol the server says it speaks", () => {
  it("is followed as it is when it is this page's, whatever build the server serves now", async () => {
    const t = tab("/static/index-h1.js");
    followServerProtocol(WIRE_PROTOCOL, t.env);
    t.becomeIdle();
    await settle();
    expect(t.did).toEqual([]);
    expect(t.announced).toEqual([]);
    t.stop();
  });

  it("is reloaded into when it is another, once the page is idle, carrying what it comes back to", async () => {
    const t = tab("/static/index-h2.js");
    followServerProtocol(WIRE_PROTOCOL + 1, t.env);
    expect(t.announced).toEqual(["waiting"]);
    await settle();
    expect(t.did).toEqual([]);

    t.becomeIdle();
    await settle();
    expect(t.did).toEqual(["carry", "reload"]);
    expect(t.announced).toEqual(["waiting", "reloading"]);
    t.stop();
  });

  it("asks the person instead when a reload landed on this same build", async () => {
    const old = tab("/static/index-h3.js");
    followServerProtocol(WIRE_PROTOCOL + 1, old.env);
    old.becomeIdle();
    await settle();
    old.stop();

    // The reload came back to the same page (a cache, a proxy): asked, not looped.
    vi.resetModules();
    const reloaded = await import("./stale-build");
    const again = tab("/static/index-h3.js", old.storage);
    reloaded.watchForNewBuild(new EventTarget(), again.env);
    reloaded.followServerProtocol(WIRE_PROTOCOL + 1, again.env);
    again.becomeIdle();
    await settle();
    expect(again.did).toEqual([]);
    expect(again.announced).toEqual(["stuck"]);
    // The person's own reload goes, as asked.
    reloaded.reloadNow(again.env);
    expect(again.did).toEqual(["carry", "reload"]);
  });

  it("asks nothing when the server names none, or on the dev server", async () => {
    const t = tab("/static/index-h5.js");
    followServerProtocol(undefined, t.env);
    const dev = tab(null);
    followServerProtocol(WIRE_PROTOCOL + 1, dev.env);
    expect(reloadForNewBuild(missing(), dev.env)).toBe(false);
    t.becomeIdle();
    dev.becomeIdle();
    await settle();
    expect([...t.did, ...dev.did, ...t.announced, ...dev.announced]).toEqual([]);
  });
});

describe("a chunk that did not arrive", () => {
  it("is known in each browser's words, through a retryable load's cause", () => {
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

  it("reloads once the page is idle, and shares one reload with the protocol and every other failure", async () => {
    const t = tab("/static/index-h6.js");
    expect(reloadForNewBuild(missing(), t.env)).toBe(true);
    expect(reloadForNewBuild(missing("https://kb/static/graph-page-x.js"), t.env)).toBe(true);
    followServerProtocol(WIRE_PROTOCOL + 1, t.env);
    expect(t.announced).toEqual(["waiting"]);
    t.becomeIdle();
    await settle();
    expect(t.did).toEqual(["carry", "reload"]);
    t.stop();
  });

  it("leaves any other failure alone", () => {
    const t = tab("/static/index-a.js");
    expect(reloadForNewBuild(new Error("webgl kaboom"), t.env)).toBe(false);
    expect(t.announced).toEqual([]);
    t.stop();
  });

  it("asks the person when storage refuses, since a reload it cannot record could loop", () => {
    const t = tab("/static/index-b.js");
    const refusing: BuildEnv = {
      ...t.env,
      storage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {},
      },
    };
    watchForNewBuild(new EventTarget(), refusing);
    expect(reloadForNewBuild(missing(), refusing)).toBe(false);
    expect(t.announced).toEqual(["stuck"]);
  });

  it("asks the person when storage reads but will not keep the record, once", async () => {
    const t = tab("/static/index-f.js");
    const full: BuildEnv = {
      ...t.env,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    };
    watchForNewBuild(new EventTarget(), full);
    expect(reloadForNewBuild(missing(), full)).toBe(true);
    t.becomeIdle();
    await settle();
    expect(t.did).toEqual([]);
    expect(t.announced).toEqual(["waiting", "stuck"]);
    // Asked once: a later need neither reloads nor asks again.
    followServerProtocol(WIRE_PROTOCOL + 1, full);
    expect(reloadForNewBuild(missing(), full)).toBe(false);
    await settle();
    expect(t.did).toEqual([]);
    expect(t.announced).toEqual(["waiting", "stuck"]);
  });

  it("is heard from Vite's failed preload, until unsubscribed", async () => {
    const target = new EventTarget();
    const t = tab("/static/index-c.js");
    const stop = watchForNewBuild(target, t.env);
    t.becomeIdle();

    target.dispatchEvent(preloadError(new Error("webgl kaboom")));
    await settle();
    expect(t.did).toEqual([]);
    const event = preloadError(missing());
    target.dispatchEvent(event);
    await settle();
    expect(t.did).toEqual(["carry", "reload"]);
    // The failure still reaches its import, which the boundary shows as an update.
    expect(event.defaultPrevented).toBe(false);

    stop();
    const unwatched = tab("/static/index-d.js");
    unwatched.stop();
    unwatched.becomeIdle();
    target.dispatchEvent(preloadError(missing()));
    await settle();
    expect(unwatched.did).toEqual([]);
  });
});

describe("reloading now", () => {
  it("records the build it leaves, so landing on it again asks the person", () => {
    const t = tab("/static/index-e.js");
    reloadNow(t.env);
    expect(t.storage.get("kb.reloaded-for-build")).toBe("/static/index-e.js");
    t.stop();
  });
});
