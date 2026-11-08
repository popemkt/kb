/** Proactive runtime change signals; ordinary calls use the same lock fingerprint. */
import { Effect, Layer, Stream } from "effect";
import { CodeTrust, ExtensionStorage } from "@kb/contracts";
import { codeTrustLayer, extensionStorageLayer } from "@kb/workspace-fs";

export function extensionRuntimeChanges(root: string) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const storage = yield* ExtensionStorage;
      const trust = yield* CodeTrust;
      return Stream.merge(storage.changes(root), trust.changes).pipe(Stream.debounce("20 millis"));
    }),
  ).pipe(Stream.provide(Layer.merge(extensionStorageLayer, codeTrustLayer())));
}
