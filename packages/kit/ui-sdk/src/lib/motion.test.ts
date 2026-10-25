import { afterEach, describe, expect, it } from "vitest";
import { prefersReducedMotion } from "./motion";

const g = globalThis as Record<string, unknown>;

describe("prefersReducedMotion", () => {
  afterEach(() => {
    delete g.window;
    delete g.document;
  });

  it("is false with no window or no matchMedia", () => {
    expect(prefersReducedMotion()).toBe(false);
    g.window = {};
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reads the media query", () => {
    const asked: string[] = [];
    g.window = {
      matchMedia: (query: string) => {
        asked.push(query);
        return { matches: true };
      },
    };
    expect(prefersReducedMotion()).toBe(true);
    expect(asked).toEqual(["(prefers-reduced-motion: reduce)"]);
  });

  it("is the person's motion mode where one is painted, the OS's under `system`", () => {
    let mode: string | null = null;
    g.document = { documentElement: { getAttribute: () => mode } };
    g.window = { matchMedia: () => ({ matches: true }) };
    expect(prefersReducedMotion()).toBe(true);
    mode = "full";
    expect(prefersReducedMotion()).toBe(false);
    mode = "system";
    expect(prefersReducedMotion()).toBe(true);
    g.window = { matchMedia: () => ({ matches: false }) };
    for (const reduced of ["reduced", "off"]) {
      mode = reduced;
      expect(prefersReducedMotion(), reduced).toBe(true);
    }
  });
});
