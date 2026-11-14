/**
 * A `kb ui` server watches the root's own extensions while it is asked to
 * (DESIGN.md → Watching the root's own extensions): an edit there is
 * followed without a lock change, its new bytes wait for trust, and the page
 * is told whether the server watches.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { SYSTEM_IDS, extensionNodeId, present } from "@kb/model";
import type { ServerMessage } from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import { childProcessEnv } from "@kb/runtime";
import { extensionModule, KB_SOURCE_BIN, trustExtension, writeExtension } from "@kb/test-kit";
import { startUi, type UiServerHandle } from "../src/index.ts";

const FOLDER = join(".kb", "extensions");
const declaration = `{name:"live",label:"Live fixture"}`;
const actions = (version: number) =>
  `[{id:"version",title:"Version",description:"Synthetic",mode:{kind:"read"},inputSchema:{parse:x=>x},outputSchema:{parse:x=>x},handler:async()=>({version:${version}})}]`;

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).toReversed()) await step();
});

async function kb(root: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn([KB_SOURCE_BIN, "--root", root, ...args], {
    env: childProcessEnv("kb"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, error] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`kb ${args.join(" ")} exited ${code}: ${error}`);
}

/** A bare root, cleaned up after the test. */
async function bareRoot(): Promise<string> {
  const at = await mkdtemp(join(tmpdir(), "kb-extension-watch-"));
  cleanup.push(() => rm(at, { recursive: true, force: true }));
  const root = join(at, "root");
  await kb(root, "init", "--bare");
  return root;
}

async function serve(root: string, watchExtensions?: boolean): Promise<UiServerHandle> {
  const handle = await Effect.runPromise(
    startUi({ root, port: 0, openBrowser: false, builds: null, watchExtensions }),
  );
  cleanup.push(() => Effect.runPromise(handle.stop));
  return handle;
}

/** A connection, and every frame it was sent from its greeting on. */
async function connect(url: string) {
  const ws = new WebSocket(url.replace("http:", "ws:") + "/ws");
  const frames: ServerMessage[] = [];
  ws.addEventListener("message", (event) => frames.push(JSON.parse(String(event.data))));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("websocket could not connect")));
  });
  cleanup.push(async () => ws.close());
  return frames;
}

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    const found = read();
    if (found !== undefined) return found;
    await Bun.sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * Ask `read` until it answers, as a page asks `kb.manifest` again after it
 * is told the manifest moved: the state is the signal, never which frame
 * came first, since a server also tells a page each runtime change (a
 * trust or lock reading, its first one at start included) whether or not
 * the composition moved.
 */
async function settled<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    const found = await read();
    if (found !== undefined) return found;
    await Bun.sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** What the server last told this connection of its watch. */
function watched(frames: readonly ServerMessage[]): string | null | undefined {
  const told = frames.filter((frame) => frame.op === "extension-watch");
  return told.at(-1)?.folder;
}

async function call(handle: UiServerHandle, id: string) {
  const response = await fetch(`${handle.url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, input: {} }),
  });
  return response.json() as Promise<{ status: string; code?: string; output?: unknown }>;
}

async function liveRow(handle: UiServerHandle) {
  const manifest = kbManifestDef.outputSchema.parse((await call(handle, "kb.manifest")).output);
  return manifest.extensions.find((row) => row.name === "live");
}

test("watching, an edit to an own extension is followed, and its new bytes wait for trust", async () => {
  const root = await bareRoot();
  await writeExtension(
    root,
    "live.ts",
    extensionModule("live", { declaration, actions: actions(1) }),
  );
  const first = await trustExtension(root, "live.ts");
  const handle = await serve(root, true);
  const frames = await connect(handle.url);

  await until(() => (watched(frames) === FOLDER ? true : undefined), "the watch to be told");
  expect(await call(handle, "ext.live.version")).toMatchObject({ output: { version: 1 } });

  // A save is a new digest nobody trusted: the server drops the family and
  // never runs the new module.
  const marker = join(root, "untrusted-ran");
  frames.length = 0;
  await writeExtension(
    root,
    "live.ts",
    extensionModule("live", {
      declaration,
      actions: actions(2),
      prelude: `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)},"ran");`,
    }),
  );
  const edited = await settled(async () => {
    const row = await liveRow(handle);
    return row !== undefined && row.digest !== first ? row : undefined;
  }, "the edit to be followed");
  await until(() => frames.find((frame) => frame.op === "manifest-changed"), "manifest-changed");
  expect(edited.trusted).toBe(false);
  expect(await call(handle, "ext.live.version")).toMatchObject({ code: "unknown_action" });
  expect(await Bun.file(marker).exists()).toBe(false);

  // Trusted again, the new bytes run.
  frames.length = 0;
  const second = await trustExtension(root, "live.ts");
  await settled(async () => {
    const row = await liveRow(handle);
    return row?.trusted === true && row.digest === second ? row : undefined;
  }, "the new bytes to be trusted");
  await until(() => frames.find((frame) => frame.op === "manifest-changed"), "manifest-changed");
  expect(await call(handle, "ext.live.version")).toMatchObject({ output: { version: 2 } });
}, 30_000);

test("a runtime change that moves nothing tells no page; the edit after it is told once", async () => {
  const root = await bareRoot();
  const source = extensionModule("live", { declaration, actions: actions(1) });
  await writeExtension(root, "live.ts", source);
  const first = await trustExtension(root, "live.ts");
  const handle = await serve(root, true);
  const frames = await connect(handle.url);
  await until(() => (watched(frames) === FOLDER ? true : undefined), "the watch to be told");

  // The watchers' first readings at start, then a save of the same bytes:
  // neither moves the composition or the trusted digests. The edit after
  // them does, and one connection's frames arrive in the order the server
  // refreshed, so whatever those two told arrives before the edit's.
  await writeExtension(root, "live.ts", source);
  await writeExtension(
    root,
    "live.ts",
    extensionModule("live", { declaration, actions: actions(2) }),
  );
  await settled(async () => {
    const row = await liveRow(handle);
    return row !== undefined && row.digest !== first ? row : undefined;
  }, "the edit to be followed");
  await until(() => frames.find((frame) => frame.op === "manifest-changed"), "manifest-changed");
  expect(frames.filter((frame) => frame.op === "manifest-changed")).toHaveLength(1);
}, 30_000);

test("without the flag, core's setting turns watching on and off, and the page is told each time", async () => {
  const root = await bareRoot();
  const handle = await serve(root);
  const frames = await connect(handle.url);
  await until(() => (watched(frames) === null ? true : undefined), "the greeting's watch");

  const core = extensionNodeId("core");
  await kb(root, "set", core, SYSTEM_IDS.extensionsWatchField, "true");
  await until(() => (watched(frames) === FOLDER ? true : undefined), "watching on");

  // On, an edit is followed: a new own extension reaches the manifest, untrusted.
  frames.length = 0;
  await writeExtension(
    root,
    "live.ts",
    extensionModule("live", { declaration, actions: actions(1) }),
  );
  await until(() => frames.find((frame) => frame.op === "manifest-changed"), "manifest-changed");
  expect(await liveRow(handle)).toMatchObject({ trusted: false });

  await kb(root, "set", core, SYSTEM_IDS.extensionsWatchField, "false");
  await until(() => (watched(frames) === null ? true : undefined), "watching off");
}, 30_000);

test("an edit to a nested imported module is followed", async () => {
  const root = await bareRoot();
  await writeExtension(root, "parts/value.ts", "export const value = 1071;");
  await writeExtension(
    root,
    "live.ts",
    extensionModule("live", {
      declaration,
      actions: actions(1).replace("version:1", "version:value"),
      prelude: 'import {value} from "./parts/value.ts";',
    }),
  );
  await trustExtension(root, "live.ts");
  const handle = await serve(root, true);
  const frames = await connect(handle.url);
  await until(() => (watched(frames) === FOLDER ? true : undefined), "watch");
  expect(await call(handle, "ext.live.version")).toMatchObject({ output: { version: 1071 } });
  await Bun.sleep(200);
  frames.length = 0;
  await writeExtension(root, "parts/value.ts", "export const value = 1072;");
  await until(() => frames.find((f) => f.op === "manifest-changed"), "nested edit");
  expect(await liveRow(handle)).toMatchObject({ trusted: false });
}, 30000);

test("recreating the watched folder follows the next extension", async () => {
  const root = await bareRoot();
  await writeExtension(
    root,
    "live.ts",
    extensionModule("live", { declaration, actions: actions(2071) }),
  );
  const first = await trustExtension(root, "live.ts");
  const handle = await serve(root, true);
  const frames = await connect(handle.url);
  await until(() => (watched(frames) === FOLDER ? true : undefined), "watch");
  expect(await call(handle, "ext.live.version")).toMatchObject({ output: { version: 2071 } });
  await Bun.sleep(200);
  frames.length = 0;
  await rm(join(root, FOLDER), { recursive: true });
  await until(() => frames.find((f) => f.op === "manifest-changed"), "folder removal");
  frames.length = 0;
  await writeExtension(
    root,
    "live.ts",
    extensionModule("live", { declaration, actions: actions(2072) }),
  );
  await until(() => frames.find((f) => f.op === "manifest-changed"), "recreated folder edit");
  const recreated = present(await liveRow(handle), "recreated extension");
  expect(recreated.trusted).toBe(false);
  expect(recreated.digest).not.toBe(first);
  expect(await call(handle, "ext.live.version")).toMatchObject({ code: "unknown_action" });
}, 30000);
