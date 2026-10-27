/**
 * Whether the server serves an action, as a half asks it through the page's
 * host (`BrowserHost.serves`): what the server's `kb.manifest` lists to the
 * page, an action a page's call is denied not among it, and nothing while no
 * server has answered. Whoever subscribed to the host hears a new manifest.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DecidedEntry } from "@kb/contracts";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
const { setPostAction } = await import("@/api/action");
const { browserHostUiPlugin } = await import("@/browser-host");
const { loadManifest } = await import("@/lib/manifest");
const { browserHost, syncUiPlugins } = await import("@kb/ui-sdk");
/** One action as the manifest lists it, with what is decided about the page's call. */
const entry = (id: string, decision: DecidedEntry["decision"]): DecidedEntry => ({
  id,
  title: id,
  description: id,
  mode: { kind: "read" },
  inputSchema: {},
  outputSchema: {},
  decision,
});
describe("what the server serves, through the page's host", () => {
  let dom: InstalledDom;
  beforeAll(() => {
    dom = installDomGlobals();
    syncUiPlugins([browserHostUiPlugin]);
    setPostAction((invocation) =>
      Promise.resolve({
        status: "succeeded",
        id: invocation.id,
        output: {
          actions: [entry("ext.agent.complete", "allow"), entry("ext.denied", "deny")],
          views: [],
          extensions: [],
        },
        rev: 1,
      }),
    );
  });
  afterAll(() => {
    syncUiPlugins([]);
    setPostAction(null);
    dom.restore();
  });
  it("is nothing until a server answers, then what it lists to the page", async () => {
    const host = browserHost();
    expect(host.serves("ext.agent.complete")).toBe(false);
    let heard = 0;
    const unsubscribe = host.subscribe(() => {
      heard += 1;
    });
    try {
      await loadManifest();
    } finally {
      unsubscribe();
    }
    expect(heard).toBeGreaterThan(0);
    expect(host.serves("ext.agent.complete")).toBe(true);
    // Listed, but a page's call to it is denied: the page is not offered it.
    expect(host.serves("ext.denied")).toBe(false);
    expect(host.serves("ext.unlisted")).toBe(false);
  });
});
