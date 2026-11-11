/** A bootstrap loads exactly the captured native bytes and serves exactly the captured page bytes. */
import { createHash, randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { canonicalJson } from "@kb/model";
import type { CodeImagePort } from "@kb/contracts";

const digest = (bytes: Uint8Array | string): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

class CodeImageLoadError extends Schema.TaggedError<CodeImageLoadError>()("Kb/CodeImageLoadError", {
  message: Schema.String,
}) {}
const imageError = (cause: unknown) =>
  new CodeImageLoadError({ message: cause instanceof Error ? cause.message : String(cause) });
const blobBytes = Effect.fn("kb.codeImage.blobBytes")(function* (blob: Blob) {
  return new Uint8Array(
    yield* Effect.tryPromise({ try: () => blob.arrayBuffer(), catch: imageError }),
  );
});

/** Loading is inseparable from identity publication; an import failure returns no authenticated image. */
export const loadCodeImage = Effect.fn("kb.loadCodeImage")(function* (
  native: Blob,
  pageFiles: ReadonlyMap<string, Blob>,
): Effect.fn.Return<
  { readonly module: unknown; readonly image: CodeImagePort },
  CodeImageLoadError
> {
  // Materialize even lazy file-backed Blobs before import or identity calculation.
  const bytes = yield* blobBytes(native);
  const page = new Map<string, Blob>();
  const entries = [...pageFiles].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const manifest: [string, string][] = [];
  for (const [name, file] of entries) {
    const body = yield* blobBytes(file);
    page.set(name, new Blob([body], { type: file.type }));
    manifest.push([name, digest(body)]);
  }
  const nativeDigest = digest(bytes);
  const pageDigest = digest(canonicalJson({ format: "kb.page-image.v1", files: manifest }));
  const generation = randomUUID();
  // The generation also prevents Bun's module cache reusing a previous load of equal bytes.
  const url = `data:text/javascript;generation=${generation};base64,${Buffer.from(bytes).toString("base64")}`;
  const loaded: unknown = yield* Effect.tryPromise({ try: () => import(url), catch: imageError });
  const identity = Object.freeze({
    kind: "packaged" as const,
    native: nativeDigest,
    page: pageDigest,
    generation,
  });
  return {
    module: loaded,
    image: Object.freeze({ identity, pageFile: (name: string) => page.get(name) ?? null }),
  };
});
