/**
 * Per-user trust is kept per digest and per machine, outside every
 * store, and a file kb did not write trusts nothing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { Cause, Effect, Exit, Layer } from "effect";
import { CodeTrust } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { currentData, codeTrustLayer } from "../src/index.ts";

const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-trust-"));
  await mkdir(join(root, ".kb"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function on<A>(
  machine: string,
  use: (trust: CodeTrust["Service"]) => Effect.Effect<A, DomainError>,
) {
  const layer = codeTrustLayer(machine).pipe(Layer.provide(BunFileSystem.layer));
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* CodeTrust);
    }).pipe(Effect.provide(layer)) as Effect.Effect<A>,
  );
}

describe("code trust on disk", () => {
  test("trusts a digest on this machine, and only that digest", async () => {
    expect(await on("mac-1", (t) => t.trusted([A, B]))).toEqual([]);
    await on("mac-1", (t) => t.trust(A));
    await on("mac-1", (t) => t.trust(A));
    expect(await on("mac-1", (t) => t.trusted([A, B]))).toEqual([A]);
    const file = JSON.parse(
      await readFile(join(await Effect.runPromise(currentData), "trust.json"), "utf8"),
    ) as {
      trusted: unknown[];
    };
    expect(file.trusted).toHaveLength(1);
  });

  test("a forged legacy file grants nothing and reads leave both files untouched", async () => {
    const legacy = JSON.stringify({
      version: 1,
      trusted: [{ digest: A, machine: "mac-1", at: "2026-11-07T00:00:00Z" }],
    });
    const path = join(root, ".kb", "trust.json");
    await writeFile(path, legacy);
    expect(await on("mac-1", (t) => t.trusted([A]))).toEqual([]);
    expect(await readFile(path, "utf8")).toBe(legacy);
    const shared = join(await Effect.runPromise(currentData), "trust.json");
    expect(await Bun.file(shared).exists()).toBe(false);
    await on("mac-1", (t) => t.trust(B));
    const before = await readFile(shared, "utf8");
    expect(await on("mac-1", (t) => t.trusted([A, B]))).toEqual([B]);
    expect(await readFile(shared, "utf8")).toBe(before);
    expect(await readFile(path, "utf8")).toBe(legacy);
  });

  test.each(['{"version":2,"trusted":[]}', '{"version":1,"trusted":['])(
    "writes refuse unreadable shared records without replacing bytes: %s",
    async (body) => {
      const file = join(await Effect.runPromise(currentData), "trust.json");
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, body);
      expect(await on("mac-1", (t) => t.trusted([A]))).toEqual([]);
      for (const change of [
        (t: CodeTrust["Service"]) => t.trust(A),
        (t: CodeTrust["Service"]) => t.untrust(A),
      ]) {
        const exit = await on("mac-1", (trust) => change(trust).pipe(Effect.exit));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const message = String(Cause.squash(exit.cause));
          expect(message).toContain("not a version-1 trust file; move it aside");
          expect(message).toContain(file);
        }
        expect(await readFile(file, "utf8")).toBe(body);
      }
    },
  );

  test("two processes retain all twelve approvals under the shared lock", async () => {
    const digests = Array.from(
      { length: 12 },
      (_, i) => `sha256:${(i + 16).toString(16).padStart(64, "0")}`,
    );
    const children = [0, 6].map((start) =>
      Bun.spawn(
        [
          process.execPath,
          "-e",
          `
      import {Effect,Layer} from "effect";
      import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
      import {CodeTrust} from "@kb/contracts";
      import {codeTrustLayer} from "./src/index.ts";
      await Effect.runPromise(Effect.gen(function* () {
        const trust = yield* CodeTrust;
        for (const digest of ${JSON.stringify(digests)}.slice(${start},${start + 6})) yield* trust.trust(digest);
      }).pipe(Effect.provide(codeTrustLayer("mac-1").pipe(Layer.provide(BunFileSystem.layer)))));
    `,
        ],
        {
          cwd: join(import.meta.dir, ".."),
          env: { ...process.env },
          stdout: "ignore",
          stderr: "pipe",
        },
      ),
    );
    for (const child of children) {
      expect(await child.exited).toBe(0);
    }
    expect(await on("mac-1", (t) => t.trusted(digests))).toEqual(digests);
  });

  test("concurrent writers retain every approved digest", async () => {
    const digests = Array.from(
      { length: 12 },
      (_, i) => `sha256:${i.toString(16).padStart(64, "0")}`,
    );
    await Promise.all(digests.map((digest) => on("mac-1", (t) => t.trust(digest))));
    expect((await on("mac-1", (t) => t.trusted(digests))).toSorted()).toEqual(digests.toSorted());
  });

  test("a record made on another machine trusts nothing here", async () => {
    await on("mac-1", (t) => t.trust(A));
    expect(await on("mac-2", (t) => t.trusted([A]))).toEqual([]);
  });

  test("untrusting drops this machine's record alone", async () => {
    await on("mac-1", (t) => t.trust(A));
    await on("mac-2", (t) => t.trust(A));
    await on("mac-1", (t) => t.untrust(A));
    expect(await on("mac-1", (t) => t.trusted([A]))).toEqual([]);
    expect(await on("mac-2", (t) => t.trusted([A]))).toEqual([A]);
  });

  test("a file kb did not write trusts nothing", async () => {
    await writeFile(join(root, ".kb", "trust.json"), '{"trusted": ["everything"]}');
    expect(await on("mac-1", (t) => t.trusted([A]))).toEqual([]);
  });
});
