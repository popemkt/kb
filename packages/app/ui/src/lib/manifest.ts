/**
 * What the server says it loaded: its `kb.manifest`, read once a server
 * answers and again whenever the page asks (DESIGN.md → Extension families).
 * The page follows it twice: its view catalog is the server's
 * (`lib/view-catalog.ts`), and its extensions are the ones the server
 * reports (`ui-plugins.ts`).
 *
 * Until a server answers — an offline page on its fixtures, or before the
 * manifest arrives — there is no manifest, and each reader falls back to the
 * page being its own server.
 */
import type { ExtensionRow } from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import type { ViewCatalogEntry } from "@kb/views";
import { postAction } from "@/api/action";
import { logWarn } from "@kb/ui-sdk";

/** The part of `kb.manifest` the page follows. */
export interface ServedManifest {
  readonly views: readonly ViewCatalogEntry[];
  readonly extensions: readonly ExtensionRow[];
}

let served: ServedManifest | null = null;
const listeners = new Set<() => void>();

/** The server's manifest now; null while no server has answered. */
export function servedManifest(): ServedManifest | null {
  return served;
}

/** Called whenever the server's manifest is read again. */
export function subscribeManifest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Record what the server answered, and tell the readers. */
function setServedManifest(next: ServedManifest): void {
  served = next;
  for (const listener of listeners) listener();
}

/**
 * Ask the server what it loaded, without following the answer yet: null
 * when it cannot answer, which the log says. The boot asks this beside the
 * graph and follows it once the graph is in (`components/App.tsx`).
 */
export async function readManifest(): Promise<ServedManifest | null> {
  const response = await postAction({ id: kbManifestDef.id, input: {} }).catch((error: unknown) => {
    logWarn(`[kb/manifest] kb.manifest unreachable: ${String(error)}`);
    return null;
  });
  if (response === null) return null;
  if (response.status !== "succeeded") {
    logWarn(`[kb/manifest] kb.manifest failed: ${response.message}`);
    return null;
  }
  const manifest = kbManifestDef.outputSchema.safeParse(response.output);
  if (!manifest.success) {
    logWarn(`[kb/manifest] kb.manifest answered in another shape: ${manifest.error.message}`);
    return null;
  }
  return { views: manifest.data.views, extensions: manifest.data.extensions };
}

/**
 * Follow `read`, a manifest {@link readManifest} asked for (a fresh ask by
 * default). A server that could not answer leaves the page as it was; it
 * never fails the boot.
 */
export async function loadManifest(
  read: Promise<ServedManifest | null> = readManifest(),
): Promise<void> {
  const manifest = await read;
  if (manifest !== null) setServedManifest(manifest);
}
