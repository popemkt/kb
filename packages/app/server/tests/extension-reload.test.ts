/** A running server follows CLI lock edits and another process's trust, without a request to prod it. */
import { expect, onTestFinished, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { extensionNodeId, present } from "@kb/model";
import { GraphSnapshotSchema, type ServerMessage } from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import { childProcessEnv, STORE_BACKENDS } from "@kb/runtime";
import { extensionModule, KB_SOURCE_BIN, writeExtension, until } from "@kb/test-kit";
import { startUi, type UiServerHandle } from "../src/index.ts";

const OWNER_QUERY =
  '[:find ?owner :where [?n :node/id "live.seed"] [?n :node/owner ?o] [?o :node/id ?owner]]';
const actions = (version: number) =>
  `[{id:"version",title:"Version",description:"Synthetic",mode:{kind:"read"},inputSchema:{parse:x=>x},outputSchema:{parse:x=>x},handler:async()=>({version:${version}})}]`;
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
  return until(
    () => frames.find(matches),
    () => `server change announcement; frames: ${JSON.stringify(frames)}`,
  );
}
async function watchFrames(ws: WebSocket) {
  const frames: ServerMessage[] = [];
  ws.addEventListener("message", (event) => frames.push(JSON.parse(String(event.data))));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("websocket could not connect")));
  });
  ws.send(JSON.stringify({ op: "subscribe", id: "owner", query: OWNER_QUERY }));
  await frame(frames, (message) => message.op === "rows");
  frames.length = 0;
  return frames;
}
async function reloadFixture(
  prefix: string,
  backend: (typeof STORE_BACKENDS)[number],
  beforeRemove?: (root: string) => Promise<void>,
) {
  const at = await mkdtemp(join(tmpdir(), prefix));
  const root = join(at, "root");
  let handle: UiServerHandle | undefined;
  let socket: WebSocket | undefined;
  onTestFinished(async () => {
    try {
      socket?.close();
      if (handle !== undefined) await Effect.runPromise(handle.stop);
    } finally {
      try {
        await beforeRemove?.(root);
      } finally {
        await rm(at, { recursive: true, force: true });
      }
    }
  });
  await child([KB_SOURCE_BIN, "--root", root, "init", "--store", backend, "--bare"]);
  return {
    at,
    root,
    start: async () => {
      handle = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false }));
      socket = new WebSocket(handle.url.replace("http:", "ws:") + "/ws");
      return { handle, frames: await watchFrames(socket) };
    },
  };
}

async function invoke(handle: UiServerHandle, id: string) {
  const response = await fetch(`${handle.url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, input: {} }),
  });
  return response.json() as Promise<{ status: string; output?: unknown }>;
}

for (const backend of STORE_BACKENDS)
  test(`${backend}: CLI selection and shared trust refresh the manifest and derived subscriptions live`, async () => {
    const { at, root, start } = await reloadFixture("kb-extension-reload-", backend);
    const source = join(at, "source");
    const declaration = `{name:"live",label:"Live fixture",seed:at=>[{id:"live.seed",text:"Synthetic seed",props:{},children:[],createdAt:at,updatedAt:at}]}`;
    const v1 = extensionModule("live", { declaration, actions: actions(1) });
    await writeExtension(source, "live.ts", v1);
    const { handle, frames } = await start();
    const cli = (...args: string[]) => child([KB_SOURCE_BIN, "--root", root, "ext", ...args]);
    await cli("link", join(source, ".kb", "extensions"), "--scope", "local");
    await frame(frames, (message) => message.op === "manifest-changed");
    const untrusted = kbManifestDef.outputSchema.parse(
      (await invoke(handle, "kb.manifest")).output,
    );
    expect(untrusted.extensions.find((row) => row.name === "live")).toMatchObject({
      trusted: false,
    });
    expect(untrusted.actions.some((action) => action.id === "ext.live.version")).toBe(false);
    frames.length = 0;
    // This test helper supplies the person's already-reviewed approval in a separate process.
    await child([
      process.execPath,
      "--no-env-file",
      "--config=/dev/null",
      "--eval",
      `import {trustExtension} from "@kb/test-kit";await trustExtension(${JSON.stringify(source)},"live.ts");`,
    ]);
    await frame(frames, (message) => message.op === "manifest-changed");
    await frame(
      frames,
      (message) =>
        message.op === "rows" &&
        JSON.stringify(message.rows) === JSON.stringify([[extensionNodeId("live")]]),
    );
    expect(await invoke(handle, "ext.live.version")).toMatchObject({
      status: "succeeded",
      output: { version: 1 },
    });
    const digest = present(
      untrusted.extensions.find((row) => row.name === "live")?.digest,
      "live digest",
    );

    // A ledger write in another process drops an already-running family.
    frames.length = 0;
    await child([
      process.execPath,
      "--no-env-file",
      "--config=/dev/null",
      "--eval",
      `import {Effect,Layer} from "effect";
       import {CodeTrust} from "@kb/contracts";
       import {codeTrustLayer} from "@kb/workspace-fs";
       import {bunFileSystemLayer} from "@kb/runtime";
       await Effect.runPromise(Effect.flatMap(CodeTrust,t=>t.untrust(${JSON.stringify(digest)})).pipe(Effect.provide(codeTrustLayer().pipe(Layer.provide(bunFileSystemLayer)))));`,
    ]);
    await frame(frames, (message) => message.op === "manifest-changed");
    expect(await invoke(handle, "ext.live.version")).toMatchObject({
      status: "failed",
      code: "unknown_action",
    });
    frames.length = 0;
    await child([
      process.execPath,
      "--no-env-file",
      "--config=/dev/null",
      "--eval",
      `import {trustExtension} from "@kb/test-kit";await trustExtension(${JSON.stringify(source)},"live.ts");`,
    ]);
    await frame(frames, (message) => message.op === "manifest-changed");
    expect(await invoke(handle, "ext.live.version")).toMatchObject({
      status: "succeeded",
      output: { version: 1 },
    });

    // Linked bytes are not watched. A stable lock change exposes the new,
    // untrusted digest, but neither its module nor its action may run.
    const marker = join(at, "untrusted-ran");
    const v2 = extensionModule("live", {
      declaration,
      actions: actions(2),
      prelude: `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)},"ran");`,
    });
    await writeExtension(source, "live.ts", v2);
    expect(await invoke(handle, "ext.live.version")).toMatchObject({
      status: "succeeded",
      output: { version: 1 },
    });
    frames.length = 0;
    const extra = join(at, "extra-folder");
    await cli("link", extra, "--scope", "local");
    await frame(frames, (message) => message.op === "manifest-changed");
    const pending = kbManifestDef.outputSchema.parse((await invoke(handle, "kb.manifest")).output);
    const candidate = present(
      pending.extensions.find((row) => row.name === "live"),
      "updated live source",
    );
    expect(candidate.trusted).toBe(false);
    expect(candidate.digest).toBeDefined();
    expect(candidate.digest).not.toBe(digest);
    expect(await invoke(handle, "ext.live.version")).toMatchObject({
      status: "failed",
      code: "unknown_action",
    });
    expect(await Bun.file(marker).exists()).toBe(false);

    // Restoring the original bytes and changing the lock rolls back live.
    await writeExtension(source, "live.ts", v1);
    frames.length = 0;
    await cli("unlink", extra, "--scope", "local");
    await frame(frames, (message) => message.op === "manifest-changed");
    const restored = kbManifestDef.outputSchema.parse((await invoke(handle, "kb.manifest")).output);
    expect(restored.extensions.find((row) => row.name === "live")).toMatchObject({
      digest,
      trusted: true,
    });
    expect(await invoke(handle, "ext.live.version")).toMatchObject({
      status: "succeeded",
      output: { version: 1 },
    });
    expect(await Bun.file(marker).exists()).toBe(false);
    frames.length = 0;
    await cli("unlink", join(source, ".kb", "extensions"), "--scope", "local");
    await frame(frames, (message) => message.op === "manifest-changed");
    await frame(frames, (message) => message.op === "rows" && message.rows.length === 0);
    const removed = kbManifestDef.outputSchema.parse((await invoke(handle, "kb.manifest")).output);
    expect(removed.extensions.some((row) => row.name === "live")).toBe(false);
    const snapshot = GraphSnapshotSchema.parse(
      await (await fetch(`${handle.url}/api/graph`)).json(),
    );
    expect(snapshot.nodes.some((node) => node.id === "live.seed")).toBe(true);
  }, 30000);

function confirmationDigest(root: string): string {
  return `sha256:${new Bun.CryptoHasher("sha256").update(root).digest("hex")}`;
}

async function changeConfirmation(root: string, trusted: boolean): Promise<void> {
  await child([
    process.execPath,
    "--no-env-file",
    "--config=/dev/null",
    "--eval",
    `import {Effect,Layer} from "effect";
     import {CodeTrust} from "@kb/contracts";
     import {codeTrustLayer} from "@kb/workspace-fs";
     import {bunFileSystemLayer} from "@kb/runtime";
     await Effect.runPromise(Effect.flatMap(CodeTrust,t=>t.${trusted ? "trust" : "untrust"}(${JSON.stringify(confirmationDigest(root))})).pipe(Effect.provide(codeTrustLayer().pipe(Layer.provide(bunFileSystemLayer)))));`,
  ]);
}

for (const backend of STORE_BACKENDS)
  test(`${backend}: machine confirmation changes refresh a tab without changing extension membership`, async () => {
    const { root, start } = await reloadFixture("kb-confirmation-reload-", backend, (rootToClean) =>
      changeConfirmation(rootToClean, false),
    );
    const digest = confirmationDigest(root);
    const { handle, frames } = await start();
    const before = kbManifestDef.outputSchema.parse((await invoke(handle, "kb.manifest")).output);
    expect(before.root).toBe(root);
    expect(before.trusted).not.toContain(digest);
    await changeConfirmation(root, true);
    await frame(frames, (message) => message.op === "manifest-changed");
    const confirmed = kbManifestDef.outputSchema.parse(
      (await invoke(handle, "kb.manifest")).output,
    );
    expect(confirmed.trusted).toContain(digest);
    expect(confirmed.extensions).toEqual(before.extensions);
    frames.length = 0;
    await changeConfirmation(root, false);
    await frame(frames, (message) => message.op === "manifest-changed");
    expect(
      kbManifestDef.outputSchema.parse((await invoke(handle, "kb.manifest")).output).trusted,
    ).not.toContain(digest);
  }, 30000);
