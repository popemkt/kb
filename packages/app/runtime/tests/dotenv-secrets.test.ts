import { expect, test } from "bun:test";
import { mkdtemp, readFile, stat, rm, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { parseSecretRef } from "@kb/model";
import { systemSecretSink, systemSecrets } from "../src/index.ts";

test("dotenv references require absolute paths and a variable name", () => {
  expect(parseSecretRef("dotenv:/tmp/key.env#TOKEN")).toEqual({
    kind: "dotenv",
    path: "/tmp/key.env",
    name: "TOKEN",
  });
  for (const input of ["dotenv:relative#KEY", "dotenv:/tmp/x", "dotenv:/tmp/x#1KEY"]) {
    expect(parseSecretRef(input)).toBeNull();
  }
});

test("dotenv rotates live, preserves other keys, stays private, and refuses unsafe files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kb-secrets-"));
  const path = join(dir, "keys.env");
  const first = { kind: "dotenv" as const, path, name: "FIRST" };
  const second = { ...first, name: "SECOND" };
  const source = systemSecrets();
  try {
    await Effect.runPromise(systemSecretSink(first).write("one"));
    await Effect.runPromise(systemSecretSink(second).write("two # $HOME"));
    expect(await Effect.runPromise(source.resolve(first))).toBe("one");
    expect(await Effect.runPromise(source.resolve(second))).toBe("two # $HOME");
    await Effect.runPromise(systemSecretSink(first).write("rotated"));
    expect(await Effect.runPromise(source.resolve(first))).toBe("rotated");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    for (const value of [
      "apostrophe'and\\slash",
      'double"quote',
      "back`tick",
      "token # $VARIABLE",
    ]) {
      await Effect.runPromise(systemSecretSink(first).write(value));
      expect(await Effect.runPromise(source.resolve(first))).toBe(value);
    }
    const proto = { ...first, name: "__proto__" };
    await Effect.runPromise(systemSecretSink(proto).write("literal key"));
    expect(await Effect.runPromise(source.resolve(proto))).toBe("literal key");
    expect(
      (await Effect.runPromise(Effect.result(source.resolve({ ...first, name: "toString" }))))._tag,
    ).toBe("Failure");
    const bytes = await readFile(path, "utf8");
    expect(bytes).toContain("SECOND");
    await chmod(path, 0o644);
    expect((await Effect.runPromise(Effect.result(source.resolve(first))))._tag).toBe("Failure");
    const denied = await Effect.runPromise(
      Effect.result(systemSecretSink(first).write("sensitive")),
    );
    expect(JSON.stringify(denied)).not.toContain("sensitive");
    await chmod(path, 0o600);
    const link = join(dir, "link.env");
    await symlink(path, link);
    expect(
      (await Effect.runPromise(Effect.result(source.resolve({ ...first, path: link }))))._tag,
    ).toBe("Failure");
    expect(
      (await Effect.runPromise(Effect.result(systemSecretSink(first).write("bad\nKEY=oops"))))._tag,
    ).toBe("Failure");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("read-only secret sources refuse writes without revealing values", async () => {
  for (const ref of [
    { kind: "env" as const, name: "TOKEN" },
    { kind: "keychain" as const, service: "kb" },
  ]) {
    const result = await Effect.runPromise(Effect.result(systemSecretSink(ref).write("sensitive")));
    expect(result._tag).toBe("Failure");
    expect(JSON.stringify(result)).not.toContain("sensitive");
  }
});
