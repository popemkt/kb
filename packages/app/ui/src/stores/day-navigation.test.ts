import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bundledPlugin } from "@kb/contracts";
import { DAYS_IDS, daysExtension } from "@kb/days";
import { daysUiPlugin } from "@kb/days-ui";
import { definePlugin } from "@kb/plugin";
import { getPath, provideRoute, RoutePoint, syncUiPlugins, type OutlineNode } from "@kb/ui-sdk";
import { installDomGlobals, testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import { viewKey } from "@kb/views";
import { coreUiPlugin } from "@/core-plugin";
import { useGraphStore } from "@/stores/graph.store";
import { runKeyCommand } from "@/stores/page-commands";
import { useWorkspaceStore } from "@/stores/workspace.store";

const DAY = "n.friday";
const DAY_PATH = "/probe/day";
const EMPTY_PATH = "/probe/settings";
const AT = "2026-11-20T00:00:00Z";

function row(id: string, text: string, props: OutlineNode["props"] = {}): OutlineNode {
  return {
    id,
    text,
    props,
    children: [],
    parentId: null,
    collapsed: false,
    tags: [],
    createdAt: AT,
    updatedAt: AT,
  };
}

const probeView = viewKey(
  "probe.page",
  "Probe",
  Schema.Struct({ root: Schema.optionalKey(Schema.String) }),
);
const probe = definePlugin({
  name: "probe",
  apply: (ctx) =>
    ctx.contribute(
      RoutePoint,
      provideRoute({
        view: probeView,
        match: (path) => {
          if (path === DAY_PATH) return { root: DAY };
          return path === EMPTY_PATH ? {} : null;
        },
        frame: () => "full",
        pendingTitle: () => "Probe",
      }),
    ),
});

describe("day navigation from the focused pane", () => {
  afterEach(() => {
    syncUiPlugins([]);
    vi.useRealTimers();
  });

  it.each([
    [DAY_PATH, "2026-11-21"],
    [EMPTY_PATH, "2026-11-24"],
  ])("runs Next day from %s and opens %s", async (path, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 23, 12));
    const dom = installDomGlobals(`https://kb.test${path}`);
    const id = `days.${expected}`;
    const invoke = vi.fn(() =>
      Promise.resolve({
        status: "succeeded" as const,
        id: DAYS_IDS.todayAction,
        output: { id },
      }),
    );
    const host = testBrowserHost({ invoke });
    host.setNodes([
      row(DAY, "Friday", { [DAYS_IDS.keyField]: [{ t: "str", v: "2026-11-20" }] }),
      row(id, expected),
    ]);
    useGraphStore.setState({ rootNodeId: DAY });
    useWorkspaceStore.setState({ layout: { tabs: [{ id: "main", path }] }, focused: "main" });
    try {
      syncUiPlugins([
        testHostPlugin(host),
        coreUiPlugin,
        bundledPlugin(daysExtension, daysUiPlugin),
        probe,
      ]);
      await runKeyCommand(DAYS_IDS.nextDayCommand, null);
      expect(invoke).toHaveBeenCalledWith(DAYS_IDS.todayAction, { day: expected });
      expect(getPath()).toBe(`/node/${id}`);
    } finally {
      dom.restore();
    }
  });
});
