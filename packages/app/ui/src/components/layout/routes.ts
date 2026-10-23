import type { NodeParams, NoParams } from "@kb/views";
import { outlineLocationOf } from "@kb/ui-sdk";

/** `/node/<id>` or `/node/<id>/<view>`: the route a node is opened by (`nodePath`). */
export function matchNode(path: string): NodeParams | null {
  const match = /^\/node\/([^/]+)(?:\/([^/]+))?\/?$/.exec(path);
  const node = match?.[1];
  if (node === undefined) return null;
  const view = match?.[2];
  return view === undefined
    ? { node: decodeURIComponent(node) }
    : { node: decodeURIComponent(node), view: decodeURIComponent(view) };
}

/**
 * `/` and `/outline/<id>`: where the page stands, unscoped (`outlineLocationOf`),
 * the home's route. Which node the page stands at follows the path
 * (`followOutlineLocation`), so the view itself takes no params; a scoped
 * location is the ontology's (`/o/<id>/outline`).
 */
export function matchHome(path: string): NoParams | null {
  return outlineLocationOf(path)?.ontology === null ? {} : null;
}
