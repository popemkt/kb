import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_TOKEN_HEADER, pageProtocols } from "@kb/contracts";

/** A tab at `href`, with the storage it keeps for itself. */
function tab(href: string) {
  const storage = new Map<string, string>();
  const location = { href };
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    location.href = url;
  });
  vi.stubGlobal("window", { location, history: { state: null, replaceState } });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  return { location, storage, replaceState };
}

/** The module as a fresh load of the page has it. */
const load = () => import("./page-token");

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("the page token on the page's side", () => {
  it("adopts the token from the fragment, out of the address bar, into the tab", async () => {
    const page = tab("http://127.0.0.1:4321/n/abc#token=s3cret");
    const { adoptPageToken, pageHeaders, socketProtocols } = await load();
    adoptPageToken();
    expect(page.location.href).toBe("http://127.0.0.1:4321/n/abc");
    expect(page.storage.get("kb.page-token")).toBe("s3cret");
    expect(pageHeaders()).toEqual({ [PAGE_TOKEN_HEADER]: "s3cret" });
    expect(socketProtocols()).toEqual(pageProtocols("s3cret"));
  });

  it("keeps the token across a reload, from the tab's storage", async () => {
    const page = tab("http://127.0.0.1:4321/#token=s3cret");
    (await load()).adoptPageToken();
    vi.resetModules();
    page.location.href = "http://127.0.0.1:4321/";
    const reloaded = await load();
    reloaded.adoptPageToken();
    expect(reloaded.pageHeaders()).toEqual({ [PAGE_TOKEN_HEADER]: "s3cret" });
  });

  it("leaves a tab opened without one alone: no header, no token protocol", async () => {
    const page = tab("http://127.0.0.1:4321/#other=1");
    const { adoptPageToken, pageHeaders, socketProtocols } = await load();
    adoptPageToken();
    expect(page.replaceState).not.toHaveBeenCalled();
    expect(page.location.href).toBe("http://127.0.0.1:4321/#other=1");
    expect(pageHeaders()).toEqual({});
    expect(socketProtocols()).toEqual([]);
  });
});
