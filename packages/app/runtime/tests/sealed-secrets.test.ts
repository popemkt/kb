import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { durableCreateFile } from "@kb/file-write";
import { Effect, Result } from "effect";
import { aesGcmCipher, sealedSecrets, systemdCredsCipher } from "../src/index.ts";
import { sealedContract } from "./sealed-contract.ts";

/** systemd-creds as the store runs it: values on stdin and stdout only. */
async function runHelper(argv: readonly string[], signal: AbortSignal, stdin?: string) {
  const child = Bun.spawn([...argv], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "ignore",
    signal,
  });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { code, stdout };
}

const systemdCreds = systemdCredsCipher(runHelper);
const hostSeals = await Effect.runPromise(systemdCreds.available);

sealedContract({ name: "aes-256-gcm", make: (dir) => aesGcmCipher(() => join(dir, "key")) });
// GAP [[01M6XSXADG90BAMC22ZXWGV57D]] — the systemd-creds cipher joins only on a host whose systemd can seal for this user without root (systemd ≥ 256); CI runners cannot.
if (hostSeals)
  sealedContract({ name: "systemd-creds", make: () => systemdCreds, timeoutMs: 30_000 });

describe("aes-256-gcm", () => {
  test("another key does not open the file, and the key file is private", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sealed-key-"));
    const dir = join(root, "secrets");
    const store = (key: string) =>
      sealedSecrets({ dir: () => dir, ciphers: [aesGcmCipher(() => join(root, key))] });
    try {
      await Effect.runPromise(store("key").sink({ kind: "sealed", name: "a" }).write("secret"));
      expect((await stat(join(root, "key"))).mode & 0o777).toBe(0o600);
      await writeFile(join(root, "other"), Buffer.alloc(32, 7).toString("base64") + "\n", {
        mode: 0o600,
      });
      const result = await Effect.runPromise(
        Effect.result(store("other").resolve({ kind: "sealed", name: "a" })),
      );
      expect(result).toMatchObject({
        failure: {
          message: "the sealed secret a: does not open with this host's key (sealed elsewhere?)",
        },
      });
      expect(await readFile(join(dir, "a.sealed"), "utf8")).not.toContain("secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("first seals at once agree on one key, published whole", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sealed-race-"));
    const dir = join(root, "secrets");
    // Separate ciphers over one key file, as two writers are.
    const writer = () =>
      sealedSecrets({ dir: () => dir, ciphers: [aesGcmCipher(() => join(dir, "key"))] });
    try {
      const names = ["a", "b", "c", "d", "e", "f"];
      await Promise.all(
        names.map((name) =>
          Effect.runPromise(writer().sink({ kind: "sealed", name }).write(`value-${name}`)),
        ),
      );
      for (const name of names)
        expect(await Effect.runPromise(writer().resolve({ kind: "sealed", name }))).toBe(
          `value-${name}`,
        );
      expect((await readFile(join(dir, "key"), "utf8")).trim()).toMatch(/^[A-Za-z0-9+/]{43}=$/);
      expect((await readdir(dir)).filter((file) => !file.endsWith(".sealed"))).toEqual(["key"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a key is created only where none is: a second writer gets false and the first key stays", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sealed-once-"));
    const path = join(root, "key");
    try {
      expect(durableCreateFile({ path, body: "first\n", mode: 0o600 })).toBe(true);
      expect(durableCreateFile({ path, body: "second\n", mode: 0o600 })).toBe(false);
      expect(await readFile(path, "utf8")).toBe("first\n");
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await readdir(root)).toEqual(["key"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("first seals from separate processes agree on one key", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sealed-procs-"));
    const dir = join(root, "secrets");
    const script = join(root, "seal.ts");
    // Each process seals its own name into the one store, all started at once.
    await writeFile(
      script,
      `import { Effect } from "effect";
import { aesGcmCipher, sealedSecrets } from ${JSON.stringify(join(import.meta.dir, "../src/index.ts"))};
const dir = process.argv[2], name = process.argv[3];
const store = sealedSecrets({ dir: () => dir, ciphers: [aesGcmCipher(() => dir + "/key")] });
await Effect.runPromise(store.sink({ kind: "sealed", name }).write("value-" + name));
`,
    );
    const names = ["p1", "p2", "p3", "p4"];
    try {
      const codes = await Promise.all(
        names.map(
          (name) =>
            Bun.spawn([process.execPath, script, dir, name], {
              cwd: import.meta.dir,
              stdout: "ignore",
              stderr: "inherit",
            }).exited,
        ),
      );
      expect(codes).toEqual([0, 0, 0, 0]);
      const store = sealedSecrets({
        dir: () => dir,
        ciphers: [aesGcmCipher(() => join(dir, "key"))],
      });
      for (const name of names)
        expect(await Effect.runPromise(store.resolve({ kind: "sealed", name }))).toBe(
          `value-${name}`,
        );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("a creation cut short leaves no key, and a malformed key is refused, never replaced", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sealed-cut-"));
    const dir = join(root, "secrets");
    const store = sealedSecrets({
      dir: () => dir,
      ciphers: [aesGcmCipher(() => join(dir, "key"))],
    });
    const write = (name: string) =>
      Effect.runPromise(Effect.result(store.sink({ kind: "sealed", name }).write("secret")));
    try {
      // A writer that died before publishing left only its candidate beside the key.
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(join(dir, "key.99999.0.tmp"), "", { mode: 0o600 });
      expect(Result.isSuccess(await write("a"))).toBe(true);
      expect(await Effect.runPromise(store.resolve({ kind: "sealed", name: "a" }))).toBe("secret");
      // A key that is there but broken may still be what older files were sealed under.
      await writeFile(join(dir, "key"), "\n", { mode: 0o600 });
      expect(await write("b")).toMatchObject({
        failure: { message: "the sealed secret b: the sealed store's key file cannot be read" },
      });
      expect(await readFile(join(dir, "key"), "utf8")).toBe("\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a store with no cipher it can use refuses to write rather than keep plaintext", async () => {
    const none = {
      id: "never",
      available: Effect.succeed(false),
      seal: () => Effect.die("unreachable"),
      open: () => Effect.die("unreachable"),
    };
    const store = sealedSecrets({ dir: () => "/nonexistent", ciphers: [none] });
    expect(
      await Effect.runPromise(Effect.result(store.sink({ kind: "sealed", name: "a" }).write("v"))),
    ).toMatchObject({
      failure: { message: "the sealed secret a: this host has no cipher to seal with" },
    });
  });
});

describe("systemd-creds", () => {
  test("seals with values on stdin only, bound to the name, with no PCR policy", async () => {
    const calls: { argv: readonly string[]; stdin: string | undefined }[] = [];
    const cipher = systemdCredsCipher((argv, _signal, stdin) => {
      calls.push({ argv, stdin });
      return Promise.resolve({ code: 0, stdout: "c2VhbGVk\nYm9keQ==\n" });
    });
    expect(await Effect.runPromise(cipher.seal("routines.a", "value"))).toBe("c2VhbGVkYm9keQ==");
    expect(calls).toEqual([
      {
        argv: ["systemd-creds", "encrypt", "--user", "--tpm2-pcrs=", "--name=routines.a", "-", "-"],
        stdin: "value",
      },
    ]);
  });
});
