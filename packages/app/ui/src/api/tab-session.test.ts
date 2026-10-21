/**
 * The tab's session id (`tab-session.ts`): minted in the browser, kept in
 * the tab's sessionStorage, so a reload keeps it; a fresh one replaces it.
 * What the server routes by it is `packages/app/server/tests/screens.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A tab: the storage it keeps for itself. */
function tab(): Map<string, string> {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  return storage;
}

/** The module as a fresh load of the page has it. */
async function load() {
  vi.resetModules();
  return await import("./tab-session");
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("the tab's session id", () => {
  it("is minted once and kept across a reload of the tab", async () => {
    const storage = tab();
    const first = await load();
    const id = first.tabSession();
    expect(id).not.toBe("");
    expect(first.tabSession()).toBe(id);
    expect(storage.get("kb.tab-session")).toBe(id);
    expect((await load()).tabSession()).toBe(id);
  });

  it("is another in another tab", async () => {
    tab();
    const a = (await load()).tabSession();
    tab();
    expect((await load()).tabSession()).not.toBe(a);
  });

  it("is replaced, and kept, when the tab renews it", async () => {
    tab();
    const session = await load();
    const old = session.tabSession();
    const renewed = session.renewTabSession();
    expect(renewed).not.toBe(old);
    expect(session.tabSession()).toBe(renewed);
    expect((await load()).tabSession()).toBe(renewed);
  });
});
