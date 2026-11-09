/**
 * A text host's paste and drop port (DESIGN-UI.md → Paste and drop): what a
 * claim makes is written at the row through the page's writes; what none
 * claims is the browser's; a claim that fails is told.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ATTACH_FILE,
  ingestPort,
  setToastSink,
  syncUiPlugins,
  type Ingested,
  type IngestHandler,
} from "@kb/ui-sdk";
import { testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";

const file = new File(["x"], "photo.png", { type: "image/png" });
const dropped: Ingested = { gesture: "drop", types: ["Files"], text: "", files: [file] };
const pasted: Ingested = { gesture: "paste", types: ["text/plain"], text: "a", files: [] };

/** The row every gesture here lands on. */
const site = () => ({ nodeId: "n.row", text: "a row" });

describe("a text host's port", () => {
  const attached: { nodeId: string; file: File }[] = [];
  const told: string[] = [];
  const base = testBrowserHost();
  const host = testBrowserHost({
    writes: {
      ...base.writes,
      attachFileToNode: (nodeId, attachedFile) => {
        attached.push({ nodeId, file: attachedFile });
        return Promise.resolve(true);
      },
    },
  });

  beforeAll(() => {
    syncUiPlugins([testHostPlugin(host)]);
    setToastSink((message) => told.push(message));
  });
  afterAll(() => syncUiPlugins([]));
  beforeEach(() => {
    attached.length = 0;
    told.length = 0;
  });

  it("accepts a drop over it while a handler takes its types, before its data is read", () => {
    const port = ingestPort(() => [ATTACH_FILE], site);
    expect(port.accepts("drop", ["Files"])).toBe(true);
    expect(port.accepts("drop", ["text/plain"])).toBe(false);
    expect(port.accepts("paste", ["Files"])).toBe(false);
  });

  it("leaves to the browser what nothing claims", () => {
    expect(ingestPort(() => [ATTACH_FILE], site).offer(pasted)).toBe(false);
    expect(ingestPort(() => [], site).offer(dropped)).toBe(false);
  });

  it("writes what the claim makes at the row: a dropped file, attached", async () => {
    expect(ingestPort(() => [ATTACH_FILE], site).offer(dropped)).toBe(true);
    await expect.poll(() => attached).toEqual([{ nodeId: "n.row", file }]);
  });

  it("tells the person when a claim fails, and writes nothing", async () => {
    const failing: IngestHandler = {
      ...ATTACH_FILE,
      ingest: () => Promise.reject(new Error("no")),
    };
    expect(ingestPort(() => [failing], site).offer(dropped)).toBe(true);
    await expect.poll(() => told).toEqual(["Nothing was made of that drop: no"]);
    expect(attached).toEqual([]);
  });
});
