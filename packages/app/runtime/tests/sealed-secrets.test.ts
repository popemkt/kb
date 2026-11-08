import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
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
