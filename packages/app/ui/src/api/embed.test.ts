/**
 * Telling an embedder this tab's session (`embed.ts`): a framed page posts
 * `{type: "kb.session", session}` to its parent once per origin the server
 * names, with that origin as the target, and again when the id is renewed;
 * a page that is not framed posts nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The page, framed by a parent whose posts are recorded, or not framed at all. */
function page(framed: boolean) {
  const posted: { message: unknown; target: string }[] = [];
  const parent = {
    postMessage: (message: unknown, target: string) => posted.push({ message, target }),
  };
  const self: { parent: unknown } = { parent: null };
  self.parent = framed ? parent : self;
  vi.stubGlobal("window", self);
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  return posted;
}

/** The modules as a fresh load of the page has them. */
async function load() {
  vi.resetModules();
  return { embed: await import("./embed"), session: await import("./tab-session") };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("telling an embedder the tab's session", () => {
  it("posts it to each allowed origin, and again when it is renewed", async () => {
    const posted = page(true);
    const { embed, session } = await load();
    embed.embedWith({ origins: ["https://bb.example", "http://localhost:3000"] });
    const first = session.tabSession();
    expect(posted).toEqual([
      { message: { type: "kb.session", session: first }, target: "https://bb.example" },
      { message: { type: "kb.session", session: first }, target: "http://localhost:3000" },
    ]);

    posted.length = 0;
    const renewed = session.renewTabSession();
    expect(renewed).not.toBe(first);
    expect(posted.map(({ message }) => message)).toEqual([
      { type: "kb.session", session: renewed },
      { type: "kb.session", session: renewed },
    ]);
  });

  it("posts nothing when no origin may frame it, or it is not framed", async () => {
    const framed = page(true);
    (await load()).embed.embedWith({ origins: [] });
    expect(framed).toEqual([]);

    const alone = page(false);
    (await load()).embed.embedWith({ origins: ["https://bb.example"] });
    expect(alone).toEqual([]);
  });
});
