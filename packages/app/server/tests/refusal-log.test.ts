/**
 * Every call the `kb ui` server refuses is written to its log, so a refusal
 * a page only showed as a toast is never invisible (`invoke.ts`).
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { startUi, type UiServerHandle } from "../src/index.ts";
import { refusalLine } from "../src/invoke.ts";

describe("refusalLine", () => {
  test("names the action, the code, the session and the nodes, never the message", () => {
    // The message quotes the graph, not the input: a stored title, over two lines.
    const line = refusalLine(
      {
        id: "ext.gallery.search",
        input: { source: "01SOURCE", query: "cats" },
        session: "tab-1",
        actor: "human",
      },
      {
        status: "failed",
        id: "ext.gallery.search",
        code: "invalid_input",
        message: "My private diary\nsecond line is a link source, not a search source",
      },
    );
    expect(line).toBe(
      "kb ui: refused ext.gallery.search (invalid_input) session tab-1 nodes 01SOURCE",
    );
  });

  test("reads node ids from the refusal's details and from placement keys", () => {
    const line = refusalLine(
      {
        id: "node.add",
        input: { id: "01NEW", text: "x", parent: "01GONE" },
        actor: "human",
      },
      {
        status: "failed",
        id: "node.add",
        code: "not_found",
        message: "node not found: 01GONE",
        details: { id: "01GONE" },
      },
    );
    expect(line).toBe("kb ui: refused node.add (not_found) nodes 01NEW,01GONE");
  });
});

describe("the server's log", () => {
  let root = "";
  let handle: UiServerHandle;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-refusal-log-"));
    handle = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false }));
  });
  afterAll(async () => {
    await Effect.runPromise(handle.stop);
    await rm(root, { recursive: true, force: true });
  });

  test("says why a page's write was refused, without its text", async () => {
    const written: string[] = [];
    const stderr = spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      const res = await fetch(`${handle.url}/api/action`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: new URL(handle.url).origin },
        body: JSON.stringify({
          id: "node.update",
          input: { id: "01DELETEDELSEWHERE", text: "typed after the delete" },
          session: "tab-b",
        }),
      });
      expect(((await res.json()) as { status: string }).status).toBe("failed");
    } finally {
      stderr.mockRestore();
    }
    expect(written).toEqual([
      "kb ui: refused node.update (not_found) session tab-b nodes 01DELETEDELSEWHERE\n",
    ]);
  });
});
