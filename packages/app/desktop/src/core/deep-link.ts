/**
 * `kb://open/<store>/<node>`: navigation only. It names a store the desktop
 * knows (by its key, or by its name as a person would type it) and,
 * optionally, a node to open in that store's window. It never writes, and a
 * store the desktop does not know opens nothing.
 */

export interface DeepLink {
  /** The store's key or name, as written in the link. */
  readonly store: string;
  /** The node to open, or null for the store's page as it was. */
  readonly node: string | null;
}

/** A node id as kb mints them (ULIDs, `sys.*` ids): no path or query characters. */
const NODE_ID = /^[\w.-]+$/;

/** The link `url` names, or null when it is not a `kb://open/…` link. */
export function parseDeepLink(url: string): DeepLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "kb:") return null;
  // `kb://open/a/b` parses with host `open`; `kb:open/a/b` without one.
  const parts = [parsed.host, ...parsed.pathname.split("/")].filter((part) => part !== "");
  const [verb, store, node, ...rest] = parts.map((part) => decodeURIComponent(part));
  if (verb !== "open" || store === undefined || rest.length > 0) return null;
  if (node === undefined) return { store, node: null };
  return NODE_ID.test(node) ? { store, node } : null;
}

/** The page path that opens `node` (DESIGN-UI.md → UI points: `/node/<id>`). */
export function nodePagePath(node: string): string {
  return `/node/${encodeURIComponent(node)}`;
}
