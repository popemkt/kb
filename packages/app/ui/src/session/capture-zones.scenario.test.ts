/**
 * A capture made in a tab whose day is not the store's (DESIGN.md → Days →
 * captures land in today): just after midnight at UTC+7, while the store's
 * zone is still on the day before. A `node.add` with no parent, run in the
 * tab, commits locally under the tab's day, which the page's provider makes
 * first (as days' does, through its own pushed action). The push carries
 * the place the tab's capture target chose, so the server commits it there
 * and never decides again in the store's zone. Driven through the real
 * live client, runtime and graph store against a server scripted to place
 * exactly as `node.add` does, the node stays where the tab showed it, the
 * store's day is never made, and no hold is left behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bundledPlugin, type WireNode } from "@kb/contracts";
import { dayKeyAt, daysExtension } from "@kb/days";
import { coreExtension } from "@kb/operations";
import { definePlugin } from "@kb/plugin";
import { CaptureTargetService, syncUiPlugins, topLevelCapture } from "@kb/ui-sdk";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/api/fixture-graph";
import { createLiveClient } from "@/api/live";
import type { KbWsClient } from "@/api/ws";
import { browserReplica, invoke, resetPushLaneForTests } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store";
import { FakeWsSocket } from "@/test-support/ws";

/** 20:30 UTC on 2026-11-11: already 03:30 on the 12th in the tab, 15:30 on the 11th in the store. */
const INSTANT = Date.UTC(2026, 10, 11, 20, 30);
const TAB_ZONE = "Asia/Ho_Chi_Minh";
const STORE_ZONE = "America/New_York";

const dayIn = (zone: string) => {
  const key = dayKeyAt(INSTANT, zone);
  if (key === null) throw new Error(`no day in ${zone}`);
  return key;
};
const TAB_DAY = `days.${dayIn(TAB_ZONE)}`;
const STORE_DAY = `days.${dayIn(STORE_ZONE)}`;
const CAPTURED = "n.captured";

const AT = new Date(INSTANT).toISOString();
const wire = (id: string, text: string, children: string[] = []): WireNode => ({
  id,
  text,
  props: {},
  children,
  createdAt: AT,
  updatedAt: AT,
});

/** The node as the page shows it now. */
const shown = (id: string) => useGraphStore.getState().index?.getNode(id);

interface Push {
  readonly id: string;
  readonly input: Record<string, unknown>;
  readonly answer: (rev: number) => void;
}

/** The page's capture target in the tab's zone: its day, made first through a pushed write, as days' provider does. */
const tabDays = definePlugin({
  name: daysExtension.name,
  apply: (ctx) =>
    ctx.provide(CaptureTargetService, async () => {
      if (useGraphStore.getState().index?.getNode(TAB_DAY) === undefined)
        await invoke("node.add", { id: TAB_DAY, text: dayIn(TAB_ZONE), parent: null });
      return TAB_DAY;
    }),
});
const core = definePlugin({
  name: coreExtension.name,
  apply: (ctx) => ctx.provide(CaptureTargetService, topLevelCapture),
});

describe("a capture across the tab's and the store's midnight", () => {
  const pushes: Push[] = [];
  let socket: FakeWsSocket;
  let client: KbWsClient;

  beforeEach(() => {
    vi.useFakeTimers({ now: INSTANT });
    resetPushLaneForTests();
    pushes.length = 0;
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
    syncUiPlugins([bundledPlugin(coreExtension, core), bundledPlugin(daysExtension, tabDays)]);
    setPostAction((invocation) =>
      invocation.id === "kb.manifest"
        ? Promise.resolve({
            status: "succeeded",
            id: invocation.id,
            rev: 0,
            output: { actions: [], views: [], extensions: [] },
          })
        : new Promise((resolve) => {
            pushes.push({
              id: invocation.id,
              input: invocation.input as Record<string, unknown>,
              answer: (rev) => resolve({ status: "succeeded", id: invocation.id, output: {}, rev }),
            });
          }),
    );
    client = createLiveClient({
      url: "ws://test/ws",
      makeSocket: () => (socket = new FakeWsSocket()),
    });
    client.connect();
    socket.accept();
    socket.deliver({ op: "hello", rev: 1 });
  });

  afterEach(() => {
    client.disconnect();
    setPostAction(null);
    syncUiPlugins([]);
    resetPushLaneForTests();
    vi.useRealTimers();
  });

  /** Where the server's `node.add` puts a node: the parent it was given, else the store's day. */
  const serverPlace = (input: Record<string, unknown>) =>
    "parent" in input ? (input.parent as string | null) : STORE_DAY;

  /** The server commits push `i` at `rev`: its frame, then its receipt. */
  async function serve(i: number, rev: number, upserts: WireNode[]) {
    socket.deliver({ op: "tx", rev, upserts, deletes: [] });
    pushes[i]?.answer(rev);
    await vi.advanceTimersByTimeAsync(0);
  }

  it("is committed by the server where the tab showed it, in the tab's day", async () => {
    expect(TAB_DAY).not.toBe(STORE_DAY);
    const receipt = await invoke("node.add", { id: CAPTURED, text: "captured after midnight" });
    await vi.advanceTimersByTimeAsync(0);
    expect(receipt.status).toBe("succeeded");
    // The tab commits under its own day, made for it.
    expect(shown(TAB_DAY)?.children).toEqual([CAPTURED]);

    // The pushes go out in order, one at a time: the tab's day first.
    expect(pushes.map(({ input }) => input.id)).toEqual([TAB_DAY]);
    expect(pushes[0]?.input).toMatchObject({ id: TAB_DAY, parent: null });
    // The server makes the tab's day where it was asked.
    await serve(0, 2, [wire(TAB_DAY, dayIn(TAB_ZONE))]);

    // Then the capture, carrying the place the tab's capture target chose:
    // the server, placing as its own node.add does, puts it there.
    const capturePush = pushes[1];
    expect(capturePush?.input).toMatchObject({ id: CAPTURED, parent: TAB_DAY });
    const place = serverPlace(capturePush?.input ?? {});
    expect(place).toBe(TAB_DAY);
    await serve(1, 3, [
      wire(TAB_DAY, dayIn(TAB_ZONE), [CAPTURED]),
      wire(CAPTURED, "captured after midnight"),
    ]);

    expect(shown(TAB_DAY)?.children).toEqual([CAPTURED]);
    expect(shown(STORE_DAY)).toBeUndefined();
    expect(shown(CAPTURED)?.text).toBe("captured after midnight");
    expect(browserReplica()?.state).toMatchObject({ rev: 3, holds: 0 });
    expect(useGraphStore.getState().rev).toBe(3);
  });

  it("reads an undefined parent as none given, and pushes the tab's place", async () => {
    await invoke("node.add", { id: CAPTURED, text: "undefined parent", parent: undefined });
    await vi.advanceTimersByTimeAsync(0);
    await serve(0, 2, [wire(TAB_DAY, dayIn(TAB_ZONE))]);
    expect(pushes[1]?.input).toMatchObject({ id: CAPTURED, parent: TAB_DAY });
    // As it crosses the wire: JSON keeps the place.
    expect(JSON.parse(JSON.stringify(pushes[1]?.input))).toMatchObject({ parent: TAB_DAY });
  });

  it("pushes a place it was given, or chose itself, as given", async () => {
    await invoke("node.add", { id: "n.top", text: "top", parent: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(pushes[0]?.input).toMatchObject({ id: "n.top", parent: null });
    await serve(0, 2, [wire("n.top", "top")]);

    const [chosen] = fixtureGraph.nodes;
    await invoke("node.add", { id: "n.under", text: "under", parent: chosen?.id });
    await vi.advanceTimersByTimeAsync(0);
    expect(pushes[1]?.input).toMatchObject({ id: "n.under", parent: chosen?.id });
    // The capture target was never asked, so nothing was made for it.
    expect(shown(TAB_DAY)).toBeUndefined();
  });
});
