import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admitKeybindings, provideKeybinding, setToastSink, syncUiPlugins } from "@kb/ui-sdk";
import { testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import { applySelectionAction } from "./selection-actions";
import { mapSelectionKey } from "./selection-keymap";
import { outlineKeybindings, SELECTION_KEY_CONTEXT } from "./test-support/keybindings";

/** The calls the host was asked to make, and what it answers each: the action's own failure for `stamp`. */
const calls: { readonly id: string; readonly input: unknown }[] = [];
const told: string[] = [];
const host = testBrowserHost({
  invoke: (id, input) => {
    calls.push({ id, input });
    return Promise.resolve(
      id === "keys.fail"
        ? { status: "failed", id, code: "invalid_input", message: "nothing to stamp" }
        : { status: "succeeded", id, output: null },
    );
  },
});

beforeAll(() => {
  syncUiPlugins([testHostPlugin(host)]);
  setToastSink((message) => told.push(message));
});
afterAll(() => syncUiPlugins([]));

/** A host that approves every owner replacing what another holds. */
const ANYONE = () => true;

const keymap = admitKeybindings(
  SELECTION_KEY_CONTEXT,
  outlineKeybindings({
    name: "keys",
    bindings: [
      provideKeybinding("stamp", {
        context: "outline.selection",
        chord: "Mod-Shift-y",
        run: { action: "keys.stamp", input: { when: "today" } },
      }),
      provideKeybinding("fail", {
        context: "outline.selection",
        chord: "Mod-Shift-u",
        run: { action: "keys.fail" },
      }),
    ],
  }),
  ANYONE,
);

const selected = {
  selectedNodeId: "n1",
  selectedInstanceKey: "tree/n1",
  activeNodeId: null,
  getPreviousVisibleInstance: () => null,
  getNextVisibleInstance: () => null,
  fieldSlotsOf: () => 0,
};

async function press(key: string): Promise<void> {
  const action = mapSelectionKey({ key, ctrlKey: true, shiftKey: true }, selected, keymap);
  if (action !== null) applySelectionAction(action);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("a key that runs an action", () => {
  it("invokes it through the page's invoke path, about the selected row", async () => {
    expect(keymap.refused).toEqual([]);
    await press("Y");
    expect(calls).toEqual([{ id: "keys.stamp", input: { when: "today", id: "n1" } }]);
  });

  it("tells the person when the call fails", async () => {
    await press("U");
    expect(told).toEqual(["keys.fail failed: nothing to stamp"]);
  });
});
