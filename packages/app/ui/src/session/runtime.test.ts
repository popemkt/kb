import { afterEach, describe, expect, it, vi } from "vitest";
import { setPostAction } from "@/api/action";
import { tabSession } from "@/api/tab-session";
import { fixtureGraph } from "@/api/fixture-graph";
import { bundledDerived } from "@kb/bundled";
import { inThreadPort } from "@kb/query"; // GAP [[01M1RXNP3EMV1ES85BVE9CXMYE]]
import { provideEngine } from "@/session/engine";
import { Effect } from "effect";
import { declarationPlugin, type ScreensPort } from "@kb/contracts";
import { coreExtension } from "@kb/operations";
import { syncUiPlugins } from "@kb/ui-sdk";
import {
  invoke,
  invokeLocal,
  invokeSettled,
  setBrowserLink,
  setLocalScreens,
  waitForBrowserPushes,
} from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store";

describe("browser action runtime", () => {
  afterEach(() => {
    setPostAction(null);
    setBrowserLink(null);
    setLocalScreens(null);
    syncUiPlugins([]);
  });

  it("fills a local write from this tab's own screen, and pushes what it filled as given", async () => {
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
    syncUiPlugins([declarationPlugin(coreExtension)]);
    const none = Effect.die(new Error("no screen command here"));
    const ownTab: ScreensPort = {
      screen: () =>
        Effect.succeed({
          tabs: [
            {
              tab: tabSession(),
              person: { name: "A" },
              route: "/",
              active: true,
              activePane: "main",
              panes: [{ id: "main", route: "/", view: null, focused: "n.root-a", selection: [] }],
            },
          ],
        }),
      navigate: () => none,
      select: () => none,
      capture: () => none,
    };
    setLocalScreens(ownTab);
    const post = vi.fn(async (invocation) => ({
      status: "succeeded" as const,
      id: invocation.id,
      output: {},
      rev: 2,
    }));
    setPostAction(post);

    const invoked = await invokeSettled({ id: "node.update", input: { text: "renamed here" } });
    const filled = { id: { from: "focused", value: "n.root-a" } };
    expect(invoked.receipt).toMatchObject({ status: "succeeded", context: filled });
    expect(useGraphStore.getState().index?.getNode("n.root-a")?.text).toBe("renamed here");
    // The server is given what the replica committed, so it fills nothing itself.
    await waitForBrowserPushes();
    expect(post).toHaveBeenCalledWith({
      id: "node.update",
      input: { text: "renamed here", id: "n.root-a" },
      session: tabSession(),
    });
    expect(await invoked.settled).toMatchObject({ status: "succeeded", context: filled });
  });

  it("changes the local index before the network push starts", async () => {
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
    const post = vi.fn(async (invocation) => ({
      status: "succeeded" as const,
      id: invocation.id,
      output: {},
      rev: 2,
    }));
    setPostAction(post);

    const invoked = invoke("node.update", { id: "n.root-a", text: "local first" });
    expect(post).not.toHaveBeenCalled();

    await invoked;
    expect(useGraphStore.getState().index?.getNode("n.root-a")?.text).toBe("local first");
    await waitForBrowserPushes();
    // The page states no actor, since the server says who calls; it states its tab session.
    expect(post).toHaveBeenCalledWith({
      id: "node.update",
      input: { id: "n.root-a", text: "local first" },
      session: tabSession(),
    });
  });

  it("answers a local read from the replica and pushes nothing", async () => {
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
    const post = vi.fn();
    setPostAction(post);

    const projected = useGraphStore.getState().wireNodes;
    const receipt = await invoke("node.get", { id: "n.root-a", depth: 0 });
    expect(receipt).toMatchObject({ status: "succeeded", output: { node: { id: "n.root-a" } } });
    // A read commits nothing, so the outline is not re-projected.
    expect(useGraphStore.getState().wireNodes).toBe(projected);
    await waitForBrowserPushes();
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses a local write its field cannot hold, before anything is pushed", async () => {
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
    const post = vi.fn();
    setPostAction(post);

    // `sys.f.hidden` is a checkbox field; the local replica commits through
    // the same integrity check the server does.
    const receipt = await invoke("node.update", {
      id: "n.root-a",
      setProps: [{ field: "sys.f.hidden", value: { t: "str", v: "yes" } }],
    });
    expect(receipt).toMatchObject({ status: "failed", code: "invalid_input" });
    expect(useGraphStore.getState().index?.getNode("n.root-a")?.props["sys.f.hidden"]).toBe(
      undefined,
    );
    await waitForBrowserPushes();
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps fifty local node updates incremental", async () => {
    // Each update reaches the engine as one transaction, never as a reload
    // of the graph; the engine's index takes a transaction incrementally
    // (`DatascriptIndex`, its own suite).
    const sent: string[] = [];
    provideEngine(() => {
      const port = inThreadPort(
        { derived: bundledDerived() },
        () => performance.now(),
        queueMicrotask,
      );
      return {
        ...port,
        send: (message) => {
          sent.push(message.op);
          port.send(message);
        },
      };
    });
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "fixtures");

    await Array.from({ length: 50 }, (_, i) => i).reduce(
      (tail, i) =>
        tail.then(async () => {
          const receipt = await invokeLocal({
            id: "node.update",
            input: { id: "n.root-a", text: `local ${i}` },
          });
          expect(receipt.status).toBe("succeeded");
          return undefined;
        }),
      Promise.resolve(),
    );

    expect(sent.filter((op) => op !== "query")).toEqual(["load", ...Array(50).fill("tx")]);
    provideEngine(() =>
      inThreadPort({ derived: bundledDerived() }, () => performance.now(), queueMicrotask),
    );
  });

  it("an equal confirming echo converges without duplicating the node", async () => {
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "fixtures");
    await invokeLocal({ id: "node.update", input: { id: "n.root-a", text: "confirmed" } });
    const local = useGraphStore.getState().index?.getNode("n.root-a");
    expect(local?.text).toBe("confirmed");

    useGraphStore.getState().applyTx(local ? [local] : [], [], { rev: 2 });
    const matches = useGraphStore
      .getState()
      .index?.storedNodes()
      .filter((node) => node.id === "n.root-a");
    expect(matches).toHaveLength(1);
    expect(matches?.[0]).toEqual(local);
  });

  it("requests reconciliation when the remote confirmation fails", async () => {
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 7, "api");
    const since = vi.fn();
    setBrowserLink({ since, fetchSnapshot: vi.fn(), retryAfter: vi.fn() });
    setPostAction(async (invocation) => ({
      status: "failed",
      id: invocation.id,
      code: "internal",
      message: "rejected",
    }));

    const receipt = await invoke("node.update", { id: "n.root-a", text: "optimistic" });
    expect(receipt.status).toBe("succeeded");
    await waitForBrowserPushes();
    expect(since).toHaveBeenCalledExactlyOnceWith(7);
  });
});
