/**
 * What a framed page does for its embedder (`embed.ts`): it posts
 * `{type: "kb.session", session}` to its parent once per origin the server
 * names, with that origin as the target, and again when the id is renewed,
 * and it loads each embed script once, told the origins; a page that is not
 * framed does neither.
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
  const scripts: { src: string; parentOrigins: string | undefined }[] = [];
  vi.stubGlobal("document", {
    createElement: () => ({ src: "", dataset: {} as Record<string, string> }),
    head: {
      append: (script: { src: string; dataset: Record<string, string> }) =>
        scripts.push({ src: script.src, parentOrigins: script.dataset.parentOrigins }),
    },
  });
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  return { posted, scripts };
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
    const { posted } = page(true);
    const { embed, session } = await load();
    embed.embedWith({ origins: ["https://bb.example", "http://localhost:3000"], scripts: [] });
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
    (await load()).embed.embedWith({ origins: [], scripts: [] });
    expect(framed.posted).toEqual([]);

    const alone = page(false);
    (await load()).embed.embedWith({ origins: ["https://bb.example"], scripts: [] });
    expect(alone.posted).toEqual([]);
  });
});

describe("loading an embedder's scripts", () => {
  const BRIDGE = "https://bb.example/api/v1/plugins/bbim/http/bridge.js";

  it("loads each once, told the allowed origins, however often the server says so", async () => {
    const { scripts } = page(true);
    const { embed } = await load();
    const embedding = {
      origins: ["https://bb.example", "http://localhost:3000"],
      scripts: [BRIDGE],
    };
    embed.embedWith(embedding);
    embed.embedWith(embedding);
    expect(scripts).toEqual([
      { src: BRIDGE, parentOrigins: "https://bb.example http://localhost:3000" },
    ]);
  });

  it("loads nothing in a page nobody frames, or when no other origin may frame it", async () => {
    const alone = page(false);
    (await load()).embed.embedWith({ origins: ["https://bb.example"], scripts: [BRIDGE] });
    expect(alone.scripts).toEqual([]);

    const framed = page(true);
    (await load()).embed.embedWith({ origins: [], scripts: [BRIDGE] });
    expect(framed.scripts).toEqual([]);
  });
});
