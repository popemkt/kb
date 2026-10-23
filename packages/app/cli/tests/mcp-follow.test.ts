/**
 * `kb mcp --session follow` (DESIGN.md → Action registry → A call made in a
 * tab session): a call that names no session is made in the person's most
 * recently active tab, resolved per call, so its "this" inputs fill from
 * what they look at now; one that names a session keeps it; without the
 * flag a call is made in none. Its tool listing lets a filled input be left
 * out.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SESSION_META_KEY, type ScreenState } from "@kb/contracts";
import { createMcpServer, type McpOptions } from "@kb/mcp";
import { bunFileSystemLayer, invoke, openKb } from "@kb/runtime";
import { startUi } from "@kb/server";
import { FAKE_TAB_SCREEN, FakeTab } from "@kb/test-kit";

const TextResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
});

function focusedOn(id: string): ScreenState {
  return {
    ...FAKE_TAB_SCREEN,
    panes: FAKE_TAB_SCREEN.panes.map((pane) => ({ ...pane, focused: id })),
  };
}

let root = "";
let ui: Effect.Success<ReturnType<typeof startUi>>;
const tabs: FakeTab[] = [];
const clients: Client[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-mcp-follow-"));
  const ctx = await openKb(root);
  for (const id of ["n.first", "n.latest"]) {
    expect((await invoke(ctx, { id: "node.add", input: { id, text: id } })).status).toBe(
      "succeeded",
    );
  }
  ui = await Effect.runPromise(
    startUi({ root, port: 0, openBrowser: false }).pipe(Effect.provide(bunFileSystemLayer)),
  );
  // The later tab to publish is the person's most recently active.
  tabs.push(await Effect.runPromise(FakeTab.open(ui.at, "tab.first", focusedOn("n.first"))));
  tabs.push(await Effect.runPromise(FakeTab.open(ui.at, "tab.latest", focusedOn("n.latest"))));
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const tab of tabs.splice(0)) await Effect.runPromise(tab.close);
  await Effect.runPromise(ui.stop);
  await rm(root, { recursive: true, force: true });
});

async function connect(options: McpOptions): Promise<Client> {
  const server = await Effect.runPromise(
    createMcpServer(root, options).pipe(Effect.provide(bunFileSystemLayer)),
  );
  const client = new Client({ name: "kb-mcp-follow", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  clients.push(client);
  return client;
}

async function rename(client: Client, session?: string) {
  const result = TextResultSchema.parse(
    await client.callTool({
      name: "node_update",
      arguments: { text: "renamed" },
      ...(session === undefined ? {} : { _meta: { [SESSION_META_KEY]: session } }),
    }),
  );
  return { failed: result.isError === true, texts: result.content.map(({ text }) => text) };
}

describe("kb mcp --session follow", () => {
  test("a call that names no session is made in the person's most recently active tab", async () => {
    const { failed, texts } = await rename(await connect({ session: "follow" }));
    expect(failed).toBe(false);
    expect(JSON.parse(texts[1] ?? "null")).toEqual({
      context: { id: { from: "focused", value: "n.latest" } },
    });
  });

  test("a call that names a session is made in it", async () => {
    const { texts } = await rename(await connect({ session: "follow" }), "tab.first");
    expect(JSON.parse(texts[1] ?? "null")).toEqual({
      context: { id: { from: "focused", value: "n.first" } },
    });
  });

  test("without it, a call that names no session is made in none, and fills nothing", async () => {
    const { failed, texts } = await rename(await connect({}));
    expect(failed).toBe(true);
    expect(texts[0]).toContain("id is required; pass it");
  });

  test("its listing lets what a session fills be left out, and the plain listing does not", async () => {
    const required = async (options: McpOptions) => {
      const { tools } = await (await connect(options)).listTools();
      return tools.find((tool) => tool.name === "node_update")?.inputSchema.required;
    };
    expect(await required({ session: "follow" })).not.toContain("id");
    expect(await required({})).toContain("id");
  });
});
