/** A running server follows CLI lock edits and another process's trust, without a request to prod it. */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { extensionNodeId } from "@kb/model";
import { GraphSnapshotSchema, type ServerMessage } from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import { childProcessEnv } from "@kb/runtime";
import { extensionModule, KB_SOURCE_BIN, writeExtension } from "@kb/test-kit";
import { startUi, type UiServerHandle } from "../src/index.ts";

const OWNER_QUERY =
  '[:find ?owner :where [?n :node/id "live.seed"] [?n :node/owner ?o] [?o :node/id ?owner]]';
async function child(argv: string[]): Promise<string> {
  const proc = Bun.spawn(argv, {
    cwd: new URL("..", import.meta.url).pathname,
    env: childProcessEnv("kb"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, error] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`synthetic child exited ${code}: ${error}`);
  return out;
}
async function frame(
  frames: ServerMessage[],
  matches: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const found = frames.find(matches);
    if (found !== undefined) return found;
    await Bun.sleep(25);
  }
  throw new Error(`server did not announce the change; frames: ${JSON.stringify(frames)}`);
}
async function watching(url: string) {
  const ws = new WebSocket(url.replace("http:", "ws:") + "/ws");
  const frames: ServerMessage[] = [];
  ws.addEventListener("message", (event) => frames.push(JSON.parse(String(event.data))));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("websocket could not connect")));
  });
  ws.send(JSON.stringify({ op: "subscribe", id: "owner", query: OWNER_QUERY }));
  await frame(frames, (message) => message.op === "rows");
  frames.length = 0;
  return { ws, frames };
}
async function invoke(handle: UiServerHandle, id: string) {
  const response = await fetch(`${handle.url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, input: {} }),
  });
  return response.json() as Promise<{ status: string; output?: unknown }>;
}

for (const backend of ["jsonl", "sqlite"] as const)
  test(`${backend}: CLI selection and shared trust refresh the manifest and derived subscriptions live`, async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-extension-reload-"));
    const root = join(at, "root");
    const source = join(at, "source");
    let handle: UiServerHandle | undefined;
    let client: Awaited<ReturnType<typeof watching>> | undefined;
    try {
      await child([KB_SOURCE_BIN, "--root", root, "init", "--store", backend, "--bare"]);
      await writeExtension(
        source,
        "live.ts",
        extensionModule("live", {
          declaration: `{name:"live",label:"Live fixture",seed:at=>[{id:"live.seed",text:"Synthetic seed",props:{},children:[],createdAt:at,updatedAt:at}]}`,
          actions: `[{id:"version",title:"Version",description:"Synthetic",mode:{kind:"read"},inputSchema:{parse:x=>x},outputSchema:{parse:x=>x},handler:async()=>({version:1})}]`,
        }),
      );
      handle = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false }));
      client = await watching(handle.url);
      const cli = (...args: string[]) => child([KB_SOURCE_BIN, "--root", root, "ext", ...args]);
      await cli("link", join(source, ".kb", "extensions"), "--scope", "local");
      await frame(client.frames, (message) => message.op === "manifest-changed");
      const untrusted = kbManifestDef.outputSchema.parse(
        (await invoke(handle, "kb.manifest")).output,
      );
      expect(untrusted.extensions.find((row) => row.name === "live")).toMatchObject({
        trusted: false,
      });
      expect(untrusted.actions.some((action) => action.id === "ext.live.version")).toBe(false);
      client.frames.length = 0;
      // This test helper supplies the person's already-reviewed approval in a separate process.
      await child([
        process.execPath,
        "--no-env-file",
        "--config=/dev/null",
        "--eval",
        `import {trustExtension} from "@kb/test-kit";await trustExtension(${JSON.stringify(source)},"live.ts");`,
      ]);
      await frame(client.frames, (message) => message.op === "manifest-changed");
      await frame(
        client.frames,
        (message) =>
          message.op === "rows" &&
          JSON.stringify(message.rows) === JSON.stringify([[extensionNodeId("live")]]),
      );
      expect(await invoke(handle, "ext.live.version")).toMatchObject({
        status: "succeeded",
        output: { version: 1 },
      });
      client.frames.length = 0;
      await cli("unlink", join(source, ".kb", "extensions"), "--scope", "local");
      await frame(client.frames, (message) => message.op === "manifest-changed");
      await frame(client.frames, (message) => message.op === "rows" && message.rows.length === 0);
      const removed = kbManifestDef.outputSchema.parse(
        (await invoke(handle, "kb.manifest")).output,
      );
      expect(removed.extensions.some((row) => row.name === "live")).toBe(false);
      const snapshot = GraphSnapshotSchema.parse(
        await (await fetch(`${handle.url}/api/graph`)).json(),
      );
      expect(snapshot.nodes.some((node) => node.id === "live.seed")).toBe(true);
    } finally {
      client?.ws.close();
      if (handle !== undefined) await Effect.runPromise(handle.stop);
      await rm(at, { recursive: true, force: true });
    }
  }, 30000);
