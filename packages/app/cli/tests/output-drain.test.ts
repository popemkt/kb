import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KB_SOURCE_BIN, extensionModule, writeTrustedExtension } from "@kb/test-kit";

let root: string;
const originalHome = process.env.KB_HOME;
const originalData = process.env.KB_DATA;
const payload = "graph-λ\n".repeat(400_000);
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-output-drain-"));
  process.env.KB_HOME = join(root, "home");
  process.env.KB_DATA = join(root, "data");
  await writeTrustedExtension(
    root,
    "output.ts",
    extensionModule("output", {
      actions: `[{id:"receipt",title:"Large receipt",description:"Pipe regression",mode:{kind:"read"},inputSchema:{parse:x=>x},outputSchema:{parse:x=>x},handler:async()=>${JSON.stringify(payload)}}]`,
    }),
  );
});
afterAll(async () => {
  if (originalHome === undefined) delete process.env.KB_HOME;
  else process.env.KB_HOME = originalHome;
  if (originalData === undefined) delete process.env.KB_DATA;
  else process.env.KB_DATA = originalData;
  await rm(root, { recursive: true, force: true });
});

async function capture(args: string[], slow: boolean) {
  const child = Bun.spawn([KB_SOURCE_BIN, "--root", root, "--governance", "off", ...args], {
    env: { ...process.env, KB_HOME: join(root, "home"), KB_DATA: join(root, "data") },
    stdin: args.at(-1) === "-" ? new Blob([JSON.stringify({ id: payload, input: {} })]) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  // Deliberately leave both OS pipes unread until the producer has filled them.
  if (slow) await Bun.sleep(1000);
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code };
}

for (const [name, args, code] of [
  ["multi-MB receipt", ["--json", "action-invoke", '{"id":"ext.output.receipt","input":{}}'], 0],
  ["multi-MB JSON error", ["--json", "action-invoke", "-"], 1],
  ["multi-MB stderr error", ["action-invoke", "-"], 1],
] as const) {
  test(`slow reader receives byte-exact ${name}`, async () => {
    const fast = await capture([...args], false);
    const slow = await capture([...args], true);
    expect(fast.code).toBe(code);
    expect(slow.code).toBe(code);
    expect(Math.max(Buffer.byteLength(fast.out), Buffer.byteLength(fast.err))).toBeGreaterThan(
      3_000_000,
    );
    if (name === "multi-MB receipt") expect(JSON.parse(fast.out).output).toBe(payload);
    expect(slow.out).toBe(fast.out);
    expect(slow.err).toBe(fast.err);
  }, 30_000);
}
