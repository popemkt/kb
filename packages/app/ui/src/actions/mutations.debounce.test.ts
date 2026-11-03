import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPostAction, type ActionRequest, type ActionResponse } from "@/api/action";
import { tabSession } from "@/api/tab-session";
import { fixtureGraph } from "@/api/fixture-graph";
import { resetPushLaneForTests, waitForBrowserPushes } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store";
import { mutations } from "./mutations";

/** The id of the one node `act` adds to the graph. */
async function added(act: () => Promise<unknown>): Promise<string> {
  const before = new Set(useGraphStore.getState().wireNodes.map((node) => node.id));
  await act();
  const fresh = useGraphStore.getState().wireNodes.filter((node) => !before.has(node.id));
  expect(fresh).toHaveLength(1);
  return fresh[0]?.id ?? "";
}

const succeeded = (invocation: ActionRequest): ActionResponse => ({
  status: "succeeded",
  id: invocation.id,
  output: {},
  rev: 2,
});

describe("debounced text invocation", () => {
  const post = vi.fn(async (invocation: ActionRequest) => succeeded(invocation));

  beforeEach(() => {
    vi.useFakeTimers();
    post.mockClear();
    setPostAction(post);
    resetPushLaneForTests();
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
  });
  afterEach(() => {
    resetPushLaneForTests();
    setPostAction(null);
    vi.useRealTimers();
  });

  it("updates the index before pushing only the coalesced text", async () => {
    await mutations.updateNodeContent("n.root-a", "one");
    await mutations.updateNodeContent("n.root-a", "two");
    expect(useGraphStore.getState().index?.getNode("n.root-a")?.text).toBe("two");
    expect(post).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(280);
    await waitForBrowserPushes();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      id: "node.update",
      input: { id: "n.root-a", text: "two" },
      session: tabSession(),
    });
  });
});

/**
 * The server is handed this tab's writes in the order the tab committed them,
 * whichever writes they are. A write the server sees out of that order is
 * judged against a graph the person never saw: typed text pushed after the
 * undo that deleted its node is refused as `node not found: <id>`.
 */
describe("the push lane keeps local commit order", () => {
  const pushed: string[] = [];
  /** Each text push as the server got it: the node, then the text. */
  const texts: string[] = [];
  const refused: string[] = [];
  /** A server that, like the real one, refuses a write to a node it does not hold. */
  const held = new Set<string>(fixtureGraph.nodes.map((node) => node.id));
  const post = vi.fn(async (invocation: ActionRequest): Promise<ActionResponse> => {
    const input = invocation.input as { id: string; text?: string };
    pushed.push(`${invocation.id} ${input.id}`);
    if (invocation.id === "node.update" && input.text !== undefined)
      texts.push(`${input.id} ${input.text}`);
    if (invocation.id === "node.add") held.add(input.id);
    else if (!held.has(input.id)) {
      refused.push(`${invocation.id} ${input.id}`);
      return {
        status: "failed",
        id: invocation.id,
        code: "not_found",
        message: `node not found: ${input.id}`,
      };
    } else if (invocation.id === "node.delete") held.delete(input.id);
    return succeeded(invocation);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    pushed.length = 0;
    texts.length = 0;
    refused.length = 0;
    post.mockClear();
    setPostAction(post);
    resetPushLaneForTests();
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
  });
  afterEach(() => {
    resetPushLaneForTests();
    setPostAction(null);
    vi.useRealTimers();
  });

  it("pushes text typed into a new row before the undo that removes the row", async () => {
    const row = await added(() => mutations.splitNode("n.root-b", "end"));
    await mutations.updateNodeContent(row, "hello");
    await mutations.undo();

    await vi.advanceTimersByTimeAsync(280);
    await waitForBrowserPushes();
    expect(pushed).toEqual([
      "node.update n.root-b",
      `node.add ${row}`,
      `node.update ${row}`,
      `node.delete ${row}`,
      "node.update n.root-b",
    ]);
    expect(refused).toEqual([]);
  });

  it("joins typed text only to the push right before it, never past a write that followed it", async () => {
    await mutations.updateNodeContent("n.root-a", "a1");
    await mutations.updateNodeContent("n.root-b", "b1");
    await mutations.updateNodeContent("n.root-a", "a2");
    await mutations.updateNodeContent("n.root-a", "a3");
    await mutations.deleteNode("n.root-b");

    await vi.advanceTimersByTimeAsync(280);
    await waitForBrowserPushes();
    expect(texts).toEqual(["n.root-a a1", "n.root-b b1", "n.root-a a3"]);
    expect(pushed.at(-1)).toBe("node.delete n.root-b");
    expect(refused).toEqual([]);
  });

  it("splits at once, without waiting for the server to answer the text before it", async () => {
    const answer = Promise.withResolvers<ActionResponse>();
    post.mockImplementationOnce((invocation) => {
      pushed.push(`${invocation.id} ${(invocation.input as { id: string }).id}`);
      return answer.promise;
    });
    await mutations.updateNodeContent("n.root-b", "abc");
    // The row the next keystroke goes to exists while the text push is still out.
    const row = await added(() => mutations.splitNode("n.root-b", 3));
    expect(useGraphStore.getState().index?.getNode("n.root-b")?.text).toBe("abc");

    answer.resolve(succeeded({ id: "node.update", input: {} }));
    await waitForBrowserPushes();
    expect(pushed).toEqual(["node.update n.root-b", "node.update n.root-b", `node.add ${row}`]);
  });
});
