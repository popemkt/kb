/**
 * Saving a look writes through the page's host, and every id the page
 * hands on names the node the server keeps: each `node.add` carries the id
 * it is given, a look's pins go under the look's, a look gone since it was
 * saved is made again with all its pins, and two saves asked at once add
 * the look once.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { EMPTY_LOOK, GALLERY_IDS, type LookDraft } from "@kb/gallery";
import { definePlugin } from "@kb/plugin";
import { BrowserHostService, setToastSink, syncUiPlugins, type BrowserHost } from "@kb/ui-sdk";
import { currentDraft, updateDraft } from "./draft";
import { saveLook } from "./save-look";

interface Call {
  readonly id: string;
  readonly input: Record<string, unknown>;
}

let calls: Call[] = [];
const host: Pick<BrowserHost, "invoke"> = {
  invoke: async (id, input) => {
    calls.push({ id, input: input as Record<string, unknown> });
    // A write answers after a turn of the loop, as the page's does.
    await Promise.resolve();
    return { status: "succeeded", id, output: {} };
  },
};
const hostPlugin = definePlugin({
  name: "host",
  apply: (ctx) => ctx.provide(BrowserHostService, host as BrowserHost),
});

const adds = () => calls.filter((call) => call.id === "node.add");
const isLook = (call: Call) =>
  Array.isArray(call.input["tags"]) && call.input["tags"].includes(GALLERY_IDS.lookTag);

const DRAFT: LookDraft = {
  ...EMPTY_LOOK,
  description: "a lighthouse at dusk",
  pins: [
    { id: null, visual: "v1", note: "the light from here" },
    { id: null, visual: "v2", note: "" },
  ],
};

describe("saving a look", () => {
  beforeEach(() => {
    calls = [];
    setToastSink(() => {});
    syncUiPlugins([hostPlugin]);
  });
  afterEach(() => syncUiPlugins([]));

  test("adds the look, then its pins under it, each with the id the page minted", async () => {
    updateDraft(() => DRAFT);
    const look = await saveLook(null, () => undefined);
    const [made, ...pins] = adds();
    expect(made !== undefined && isLook(made)).toBe(true);
    expect(look).toBe(made?.input["id"]);
    expect(pins.map((pin) => pin.input["parent"])).toEqual([look, look]);
    for (const call of adds()) expect(call.input["id"]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const saved = currentDraft();
    expect(saved.id).toBe(look);
    expect(saved.pins.map((pin) => pin.id)).toEqual(pins.map((pin) => pin.input["id"]));
  });

  test("makes a look gone since it was saved again, and every pin with it", async () => {
    updateDraft(() => ({
      ...DRAFT,
      id: "gone",
      pins: DRAFT.pins.map((pin, i) => ({ ...pin, id: `old-${i}` })),
    }));
    const look = await saveLook(null, () => undefined);
    expect(adds()).toHaveLength(3);
    expect(look).not.toBe("gone");
    expect(currentDraft().pins.every((pin) => pin.id !== null && !pin.id.startsWith("old"))).toBe(
      true,
    );
  });

  test("two saves asked at once add the look once", async () => {
    updateDraft(() => DRAFT);
    const [first, second] = await Promise.all([
      saveLook(null, () => undefined),
      saveLook(null, () => undefined),
    ]);
    expect(first).toBe(second);
    expect(adds().filter(isLook)).toHaveLength(1);
  });
});
