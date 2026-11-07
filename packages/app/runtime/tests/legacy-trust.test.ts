import { expect, test } from "bun:test";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { currentData } from "@kb/workspace-fs";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";

const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;
test("forged legacy trust grants nothing anywhere; only an approved explicit import changes shared trust", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-legacy-"));
  const file = join(root, "hostile", ".kb", "trust.json");
  const body = JSON.stringify({
    version: 1,
    trusted: [
      { digest: A, machine: hostname(), at: "2026-11-07T00:00:00Z" },
      { digest: B, machine: "other-machine", at: "2026-11-07T00:00:00Z" },
    ],
  });
  try {
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, body);
    const hostile = await openKb(join(root, "hostile"));
    const other = await openKb(join(root, "other"));
    for (const ctx of [hostile, other, hostile]) {
      expect(
        await invoke(ctx, { id: "sandbox.trusted", input: { digests: [A, B] }, actor: "agent" }),
      ).toMatchObject({ status: "succeeded", output: { trusted: [] } });
    }
    const shared = join(await Effect.runPromise(currentData), "trust.json");
    expect(await Bun.file(shared).exists()).toBe(false);
    expect(await readFile(file, "utf8")).toBe(body);
    expect(
      await invoke(hostile, {
        id: "sandbox.trust.import",
        input: { root: join(root, "hostile"), digests: [A] },
        actor: "agent",
      }),
    ).toMatchObject({ status: "failed", code: "approval_required" });
    expect(await Bun.file(shared).exists()).toBe(false);
    expect(
      await invoke(hostile, {
        id: "sandbox.trust.import",
        input: { root: join(root, "hostile"), digests: [B] },
        actor: "human",
      }),
    ).toMatchObject({ status: "failed", code: "invalid_input" });
    expect(
      await invoke(hostile, {
        id: "sandbox.trust.import",
        input: { root: join(root, "hostile"), digests: [A] },
        actor: "human",
      }),
    ).toMatchObject({ status: "succeeded", output: { imported: [A] } });
    expect(
      await invoke(other, { id: "sandbox.trusted", input: { digests: [A, B] }, actor: "agent" }),
    ).toMatchObject({ status: "succeeded", output: { trusted: [A] } });
    expect(await readFile(file, "utf8")).toBe(body);
    const beforeOpen = await readFile(shared, "utf8");
    await openKb(join(root, "hostile"));
    expect(await readFile(shared, "utf8")).toBe(beforeOpen);
    for (const corrupt of ['{"version":2,"trusted":[]}', '{"version":1,"trusted":[']) {
      await writeFile(shared, corrupt);
      expect(
        await invoke(hostile, {
          id: "sandbox.trust.import",
          input: { root: join(root, "hostile"), digests: [A] },
          actor: "human",
        }),
      ).toMatchObject({ status: "failed", code: "internal" });
      expect(await readFile(shared, "utf8")).toBe(corrupt);
    }
    const listed = await invoke(hostile, { id: "extension.list", input: {}, actor: "agent" });
    expect(listed).toMatchObject({
      status: "succeeded",
      output: { failures: [{ file: ".kb/trust.json", error: expect.stringContaining("ignored") }] },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
