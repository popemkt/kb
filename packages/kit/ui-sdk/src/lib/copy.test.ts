import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copy";
import { setToastSink } from "./toast";

describe("a copy said in a toast", () => {
  const said: string[] = [];
  afterEach(() => {
    said.length = 0;
    vi.unstubAllGlobals();
  });

  function stubClipboard(writeText: (text: string) => Promise<void>): void {
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    setToastSink((message) => said.push(message));
  }

  it("puts the text on the clipboard and says what was copied", async () => {
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    copyText("01ABC", "Node ID");
    await vi.waitFor(() => expect(said).toEqual(["Node ID copied"]));
    expect(written).toEqual(["01ABC"]);
  });

  it("says it could not, naming what mid-sentence with its initialism kept", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    copyText("01ABC", "Node ID");
    await vi.waitFor(() => expect(said).toEqual(["Could not copy the node ID"]));
  });
});
