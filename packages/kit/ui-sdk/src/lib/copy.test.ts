import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, putFlavours, writeFlavours } from "./copy";
import { setToastSink } from "./toast";

describe("a copy said in a toast", () => {
  const said: string[] = [];
  const kinds: string[] = [];
  afterEach(() => {
    said.length = 0;
    kinds.length = 0;
    vi.unstubAllGlobals();
  });

  function stubClipboard(writeText: (text: string) => Promise<void>): void {
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    setToastSink((message, kind) => {
      said.push(message);
      kinds.push(kind);
    });
  }

  it("puts the text on the clipboard and says what was copied", async () => {
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    expect(await copyText("01ABC", "Node ID")).toBe(true);
    expect(said).toEqual(["Node ID copied"]);
    expect(kinds).toEqual(["info"]);
    expect(written).toEqual(["01ABC"]);
  });

  it("says it could not and what to do, naming what mid-sentence with its initialism kept", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    expect(await copyText("01ABC", "Node ID")).toBe(false);
    expect(said).toEqual(["Couldn't copy the node ID: select it and copy it by hand"]);
    expect(kinds).toEqual(["error"]);
  });
});

describe("flavours", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts each flavour into a copy event's data", () => {
    const set: [string, string][] = [];
    putFlavours({ setData: (type: string, text: string) => set.push([type, text]) } as never, {
      "text/plain": "- a",
      "application/x-kb-outline": "[]",
    });
    expect(set).toEqual([
      ["text/plain", "- a"],
      ["application/x-kb-outline", "[]"],
    ]);
  });

  it("writes several flavours as one clipboard item", async () => {
    const items: unknown[] = [];
    vi.stubGlobal("navigator", {
      clipboard: {
        write: (written: unknown[]) => {
          items.push(...written);
          return Promise.resolve();
        },
      },
    });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        readonly types: string[];
        constructor(blobs: Record<string, Blob>) {
          this.types = Object.keys(blobs);
        }
      },
    );
    setToastSink(() => {});
    expect(await writeFlavours({ "text/plain": "a", "text/html": "<ul></ul>" }, "Rows")).toBe(true);
    expect(items).toEqual([{ types: ["text/plain", "text/html"] }]);
  });
});
