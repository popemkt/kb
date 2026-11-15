/**
 * A node command and a picker step written as data (DESIGN-UI.md → The node
 * menu): the page reads their saved queries, runs the picker and makes the
 * call, through the page's one invoke path, with the row as `id` and the
 * pick where the input says `PICKED`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS, present } from "@kb/model";
import {
  derivedWith,
  PICKED,
  provideCommand,
  providePaletteStep,
  setToastSink,
  syncUiPlugins,
  wireToOutlineMap,
  type CommandContext,
  type NodeCommand,
} from "@kb/ui-sdk";
import { answersOver, DatascriptIndex, testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import { pageCommandApi } from "@/stores/page-commands";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

const AT = "2026-11-09T00:00:00.000Z";
const TOPICS_EDN =
  '[:find ?id :where [?t :node/id "t.topic"] [?n :f/sys.f.type ?t] [?n :node/id ?id]]';
const ROWS_EDN = '[:find ?id :where [?n :node/id ?id] [(= ?id "n.row")]]';

function wire(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}
const tagged = { [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: "t.topic" }] };
const query = (edn: string) => ({ [SYSTEM_IDS.queryField]: [{ t: "str" as const, v: edn }] });
const GRAPH: readonly WireNode[] = [
  wire("t.topic", "topic"),
  wire("n.row", "a row"),
  wire("n.zeta", "Zeta", tagged),
  wire("n.alpha", "Alpha", tagged),
  wire("q.topics", "topics", query(TOPICS_EDN)),
  wire("q.rows", "rows", query(ROWS_EDN)),
];

const queries = answersOver(new DatascriptIndex([...GRAPH], { derived: derivedWith({}) }));
const calls: { readonly id: string; readonly input: unknown }[] = [];
const told: string[] = [];
const host = testBrowserHost({
  queries: () => queries,
  invoke: (id, input) => {
    calls.push({ id, input });
    return Promise.resolve(
      id === "node.fail"
        ? { status: "failed", id, code: "invalid_input", message: "no such field" }
        : { status: "succeeded", id, output: null },
    );
  },
});
host.setNodes(wireToOutlineMap([...GRAPH], new Set()).values());

const opened: string[] = [];
let closed = 0;
function context(nodeId: string): CommandContext {
  return {
    target: { nodeId, frameId: nodeId, nodeIds: [nodeId] },
    outline: pageCommandApi(),
    prefs: usePrefsStore.getState(),
    ui: useUiStore.getState(),
    debugFields: useDebugFieldsStore.getState(),
    workspace: useWorkspaceStore.getState(),
    palette: { close: () => (closed += 1), openStep: (step) => opened.push(step) },
  };
}

function nodeCommand(entry: { readonly value: unknown }): NodeCommand {
  const command = entry.value as NodeCommand;
  expect(command.menu.where).toBe("node");
  return command;
}

beforeAll(() => {
  syncUiPlugins([testHostPlugin(host)]);
  setToastSink((message) => told.push(message));
});
afterAll(() => syncUiPlugins([]));
beforeEach(() => {
  calls.length = 0;
  told.length = 0;
  opened.length = 0;
  closed = 0;
});

describe("a node command as data", () => {
  const link = nodeCommand(
    provideCommand("link", {
      label: "Link to topic…",
      icon: "link",
      group: "make",
      order: 70,
      when: "q.rows",
      run: { step: "links.pick" },
    }),
  );
  const stamp = nodeCommand(
    provideCommand("stamp", {
      label: "Stamp",
      group: "mark",
      order: 30,
      run: { action: "node.update", input: { text: "stamped" } },
    }),
  );

  it("sits where it says, named by its label and icon", () => {
    expect(link.menu).toEqual({ where: "node", group: "make", order: 70 });
    const chrome = link.chrome(context("n.row"));
    expect(chrome.label).toBe("Link to topic…");
    expect(chrome.icon).not.toBeNull();
    expect(stamp.chrome(context("n.row")).icon).toBeNull();
  });

  it("is offered on the rows its query answers, once it has an answer", async () => {
    expect(link.when?.(context("n.row"))).toBe(false);
    await queries.ask(ROWS_EDN);
    expect(link.when?.(context("n.row"))).toBe(true);
    expect(link.when?.(context("n.alpha"))).toBe(false);
    expect(stamp.when).toBeUndefined();
  });

  it("opens the step it names, or calls its action about the row and closes the menu", async () => {
    await link.run(context("n.row"));
    expect(opened).toEqual(["links.pick"]);
    await stamp.run(context("n.row"));
    expect(closed).toBe(1);
    await expect
      .poll(() => calls)
      .toEqual([{ id: "node.update", input: { text: "stamped", id: "n.row" } }]);
  });

  it("refuses a group the menu does not have, or an icon kb does not name", () => {
    const form = { label: "x", group: "make", order: 1, run: { action: "node.get" } } as const;
    expect(() => provideCommand("bad", { ...form, group: "top" as never })).toThrow(
      /no group of the node menu/,
    );
    for (const icon of ["unicorn", "constructor", "toString", "__proto__"]) {
      expect(() => provideCommand("bad", { ...form, icon: icon as never })).toThrow(
        /no icon kb names/,
      );
      expect(() =>
        providePaletteStep("bad", {
          label: "x",
          placeholder: "x",
          icon: icon as never,
          candidates: "q.topics",
          commit: { action: "node.get" },
        }),
      ).toThrow(/no icon kb names/);
    }
  });
});

describe("a picker step as data", () => {
  const field = "links.f.topics";
  const step = providePaletteStep("pick", {
    label: "Link to topic",
    placeholder: "Search topics…",
    icon: "link",
    candidates: "q.topics",
    commit: {
      action: "node.update",
      input: { setProps: [{ field, value: { t: "ref", v: PICKED } }] },
    },
  }).value;
  const graph = (anchorId: string) => ({
    nodes: host.nodes(),
    wireNodes: GRAPH,
    anchorId,
    targetNodeIds: [anchorId],
  });

  it("offers the nodes its query answers, by their text, less the row it is about", async () => {
    expect(step.candidates(graph("n.row"))).toEqual([]);
    await queries.ask(TOPICS_EDN);
    expect(step.candidates(graph("n.row"))).toEqual([
      { id: "n.alpha", label: "Alpha" },
      { id: "n.zeta", label: "Zeta" },
    ]);
    expect(step.candidates(graph("n.alpha")).map(({ id }) => id)).toEqual(["n.zeta"]);
    expect(step.createLabel).toBeUndefined();
  });

  it("calls its action about the row, the pick where the input says PICKED", async () => {
    await step.commit({
      targetNodeId: "n.row",
      targetNodeIds: ["n.row"],
      schema: host.schema(),
      pickedId: "n.alpha",
      creating: false,
      alternate: false,
      name: "",
    });
    expect(calls).toEqual([
      {
        id: "node.update",
        input: { setProps: [{ field, value: { t: "ref", v: "n.alpha" } }], id: "n.row" },
      },
    ]);
  });

  it("tells the person when the call fails", async () => {
    const failing = providePaletteStep("fail", {
      label: "x",
      placeholder: "x",
      candidates: "q.topics",
      commit: { action: "node.fail" },
    }).value;
    await failing.commit({
      targetNodeId: "n.row",
      targetNodeIds: ["n.row"],
      schema: host.schema(),
      pickedId: "n.alpha",
      creating: false,
      alternate: false,
      name: "",
    });
    expect(present(told[0], "a toast")).toBe("node.fail failed: no such field");
  });
});
