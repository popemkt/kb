/**
 * The digest a person trusts a repository extension by covers its manifest
 * where it keeps one, so what they read about it is what they trusted; and
 * a closure with no manifest keeps the digest it had before manifests
 * existed, so no trust already given is lost.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { extensionDigest, trustDigest } from "@kb/sandbox";

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);
const CLOSURE = { server: "export default 1;", page: null };

describe("an extension's digest", () => {
  test("without a manifest, is the digest of its two halves alone, as it always was", async () => {
    // The format and fields the digest was taken over before manifests: `kb.extension/2`.
    const before = await run(trustDigest({ format: "kb.extension/2", ...CLOSURE }));
    expect(await run(extensionDigest({ ...CLOSURE, manifest: null }))).toBe(before);
  });

  test("with a manifest, changes with every byte of it", async () => {
    const plain = await run(extensionDigest({ ...CLOSURE, manifest: null }));
    const said = await run(extensionDigest({ ...CLOSURE, manifest: '{"license":"MIT"}' }));
    const resaid = await run(extensionDigest({ ...CLOSURE, manifest: '{"license":"MIT" }' }));
    expect(said).not.toBe(plain);
    expect(resaid).not.toBe(said);
  });
});
