import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect } from "effect";
import { CAPTURE_SUBMIT, CaptureReceiptSchema } from "@kb/contracts";
import { createMcpServer } from "@kb/mcp";
import { bunFileSystemLayer } from "@kb/runtime";
import { z } from "zod";

const ToolOutput = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })).nonempty(),
});

test("MCP lists and calls the raw capture registry action", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-capture-mcp-"));
  const server = await Effect.runPromise(
    createMcpServer(root).pipe(Effect.provide(bunFileSystemLayer)),
  );
  const client = new Client({ name: "raw-capture-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const submit = CAPTURE_SUBMIT.replaceAll(".", "_");
    expect((await client.listTools()).tools.some(({ name }) => name === submit)).toBe(true);
    const call = async (name: string, args: Record<string, unknown>) => {
      const answer = ToolOutput.parse(await client.callTool({ name, arguments: args }));
      expect(answer.isError).toBeUndefined();
      return JSON.parse(answer.content[0]?.text ?? "null") as unknown;
    };
    expect(await call("kb_manifest", {})).toMatchObject({ captureContract: 1 });
    const input = {
      captureId: crypto.randomUUID(),
      capturedAt: "2026-11-18T01:00:00Z",
      text: "Shared via MCP",
      target: { parent: null },
    };
    const receipt = CaptureReceiptSchema.parse(await call(submit, input));
    expect(receipt.captureId).toBe(input.captureId);
    expect(await call(submit, input)).toEqual(receipt);
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
