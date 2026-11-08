import { expect, it } from "vitest";
import { extensionRow } from "@kb/contracts";
import { loadManifest, servedManifest, subscribeManifest, type ManifestRead } from "./manifest";

it("a slow older manifest cannot replace the catalog from the latest notification", async () => {
  const older = Promise.withResolvers<ManifestRead>();
  const current = {
    views: [],
    extensions: [extensionRow({ name: "newer", label: "Newer" }, "fixture", true)],
  };
  const seen: unknown[] = [];
  const unsubscribe = subscribeManifest(() => seen.push(servedManifest()));
  try {
    const waiting = loadManifest(older.promise);
    await loadManifest(Promise.resolve({ manifest: current }));
    older.resolve({ manifest: { views: [], extensions: [] } });
    await waiting;
    expect(servedManifest()).toEqual(current);
    expect(seen).toEqual([current]);
  } finally {
    unsubscribe();
  }
});
