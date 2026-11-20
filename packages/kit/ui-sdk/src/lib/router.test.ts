import { afterEach, describe, expect, it, vi } from "vitest";
import { outlineLocationOf, outlinePath, type OutlineLocation } from "./router";

interface Entry {
  readonly path: string;
  readonly state: unknown;
}

/** The History interface used by both the browser and desktop shell. */
class TestWindow extends EventTarget {
  private active = 0;
  private entries: Entry[] = [{ path: "/", state: null }];

  get location() {
    return { pathname: this.entries[this.active]?.path };
  }

  get history() {
    return {
      state: this.entries[this.active]?.state,
      replaceState: (state: unknown, _unused: string, path: string) => {
        this.entries[this.active] = { path, state };
      },
      pushState: (state: unknown, _unused: string, path: string) => {
        this.entries.splice(this.active + 1, this.entries.length, { path, state });
        this.active += 1;
      },
      go: (delta: number) => {
        const next = this.active + delta;
        if (this.entries[next] === undefined) return;
        this.active = next;
        this.dispatchEvent(new Event("popstate"));
      },
    };
  }
}

async function freshRouter() {
  vi.resetModules();
  return import("./router");
}

describe("in-app history", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("notifies on traversal, keeps replacements in place and drops forward on a branch", async () => {
    vi.stubGlobal("window", new TestWindow());
    const { canGo, getPath, go, navigate, replacePath, subscribePath } = await freshRouter();
    const changed = vi.fn(getPath);
    const stop = subscribePath(changed);
    try {
      expect(canGo()).toEqual({ back: false, forward: false });
      navigate("/node/backlog");
      replacePath("/node/launch");
      expect(canGo()).toEqual({ back: true, forward: false });
      go(-1);
      expect(canGo()).toEqual({ back: false, forward: true });
      expect(changed.mock.results.map(({ value }) => value)).toEqual([
        "/node/backlog",
        "/node/launch",
        "/",
      ]);
      go(1);
      expect(getPath()).toBe("/node/launch");
      go(-1);
      navigate("/node/spec");
      go(1);
      expect(getPath()).toBe("/node/spec");
      expect(canGo()).toEqual({ back: true, forward: false });
    } finally {
      stop();
    }
  });

  it("retains back on reload while forward stays unknown until observed", async () => {
    const page = new TestWindow();
    vi.stubGlobal("window", page);
    const { navigate } = await freshRouter();
    navigate("/node/atlas");
    navigate("/node/backlog");
    page.history.go(-1);

    const { canGo, go, subscribePath } = await freshRouter();
    const stop = subscribePath(() => {});
    try {
      expect(canGo()).toEqual({ back: true, forward: false });
      go(1);
      expect(page.location.pathname).toBe("/node/atlas");
      page.history.go(1);
      go(-1);
      expect(canGo()).toEqual({ back: true, forward: true });
    } finally {
      stop();
    }
  });
});

describe("the outline location", () => {
  const places: readonly [OutlineLocation, string][] = [
    [{ ontology: null, zoom: null }, "/"],
    [{ ontology: null, zoom: "n.a" }, "/outline/n.a"],
    [{ ontology: "o.1", zoom: null }, "/o/o.1/outline"],
    [{ ontology: "o.1", zoom: "n.a" }, "/o/o.1/outline/n.a"],
    [{ ontology: null, zoom: "a b/c" }, "/outline/a%20b%2Fc"],
  ];

  it.each(places)("%o is %s, and reads back", (at, path) => {
    expect(outlinePath(at)).toBe(path);
    expect(outlineLocationOf(path)).toEqual(at);
  });

  it("names no place for any other path, or one that does not decode", () => {
    for (const path of [
      "/outline",
      "/graph",
      "/node/n.a",
      "/o/o.1",
      "/o/o.1/graph",
      "/outline/%E0%A4%A",
    ]) {
      expect(outlineLocationOf(path)).toBeNull();
    }
  });
});
