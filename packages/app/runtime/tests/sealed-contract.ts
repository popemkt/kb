/**
 * What every sealed-store cipher promises (DESIGN.md → Writable host
 * secrets), run over each one by `sealed-secrets.test.ts`: a value reads
 * back as written and rotates in place; the file holds no plaintext and is
 * private in a private directory; and a file renamed to another reference,
 * or tampered with, does not open. A cipher joins by being listed there.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { sealedSecrets, type SealCipher } from "../src/index.ts";

export interface CipherUnderTest {
  readonly name: string;
  readonly make: (dir: string) => SealCipher;
  /** How long one test may take: a helper-backed cipher pays a process per seal and open. */
  readonly timeoutMs?: number;
}

const VALUE = "GOCSPX-contract-secret-0123456789";

type Store = ReturnType<typeof sealedSecrets>;
const read = (store: Store, name: string) =>
  Effect.runPromise(Effect.result(store.resolve({ kind: "sealed", name })));
const write = (store: Store, name: string, value: string) =>
  Effect.runPromise(store.sink({ kind: "sealed", name }).write(value));

export function sealedContract(cipher: CipherUnderTest): void {
  describe(`sealed store over ${cipher.name}`, () => {
    const withStore = async (
      body: (dir: string, store: ReturnType<typeof sealedSecrets>) => Promise<void>,
    ) => {
      const root = await mkdtemp(join(tmpdir(), "kb-sealed-"));
      const dir = join(root, "secrets");
      try {
        await body(dir, sealedSecrets({ dir: () => dir, ciphers: [cipher.make(dir)] }));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    };

    test(
      "a value reads back as written, and a rewrite replaces it",
      async () => {
        await withStore(async (_dir, store) => {
          await write(store, "routines.a", VALUE);
          expect(await read(store, "routines.a")).toMatchObject({ success: VALUE });
          await write(store, "routines.a", "rotated · ünïcode");
          expect(await read(store, "routines.a")).toMatchObject({ success: "rotated · ünïcode" });
          expect(await read(store, "routines.unset")).toMatchObject({
            failure: { message: "the sealed secret routines.unset is not set" },
          });
        });
      },
      cipher.timeoutMs,
    );

    test(
      "the file holds no plaintext, and is private in a private directory",
      async () => {
        await withStore(async (dir, store) => {
          await write(store, "routines.a", VALUE);
          const path = join(dir, "routines.a.sealed");
          const text = await readFile(path, "utf8");
          expect(text.startsWith(`kb-sealed/1 ${cipher.name}\n`)).toBe(true);
          expect(text).not.toContain(VALUE);
          expect(text).not.toContain(Buffer.from(VALUE).toString("base64"));
          expect((await stat(path)).mode & 0o777).toBe(0o600);
          expect((await stat(dir)).mode & 0o777).toBe(0o700);
        });
      },
      cipher.timeoutMs,
    );

    test(
      "a file renamed to another reference, or tampered with, does not open",
      async () => {
        await withStore(async (dir, store) => {
          await write(store, "routines.a", VALUE);
          await rename(join(dir, "routines.a.sealed"), join(dir, "routines.b.sealed"));
          const moved = await read(store, "routines.b");
          expect(Result.isFailure(moved)).toBe(true);
          expect(JSON.stringify(moved)).not.toContain(VALUE);
          await write(store, "routines.c", VALUE);
          const path = join(dir, "routines.c.sealed");
          const [header = "", body = ""] = (await readFile(path, "utf8")).split("\n");
          const flipped = body.slice(0, 40) + (body[40] === "A" ? "B" : "A") + body.slice(41);
          await writeFile(path, `${header}\n${flipped}\n`, { mode: 0o600 });
          expect(Result.isFailure(await read(store, "routines.c"))).toBe(true);
        });
      },
      cipher.timeoutMs,
    );

    test(
      "erase forgets the value, and erasing an unset one succeeds",
      async () => {
        await withStore(async (_dir, store) => {
          await write(store, "routines.a", VALUE);
          await Effect.runPromise(store.sink({ kind: "sealed", name: "routines.a" }).erase);
          expect(await read(store, "routines.a")).toMatchObject({
            failure: { message: "the sealed secret routines.a is not set" },
          });
          await Effect.runPromise(store.sink({ kind: "sealed", name: "routines.a" }).erase);
        });
      },
      cipher.timeoutMs,
    );

    test(
      "a file others may read is refused before it is opened",
      async () => {
        await withStore(async (dir, store) => {
          await write(store, "routines.a", VALUE);
          const path = join(dir, "routines.a.sealed");
          await writeFile(path, await readFile(path, "utf8"), { mode: 0o644 });
          const { chmod } = await import("node:fs/promises");
          await chmod(path, 0o644);
          expect(await read(store, "routines.a")).toMatchObject({
            failure: {
              message:
                "the sealed secret routines.a: the sealed file is not a private regular file",
            },
          });
        });
      },
      cipher.timeoutMs,
    );
  });
}
