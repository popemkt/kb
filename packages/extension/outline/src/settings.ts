/**
 * The outline family's settings, read off its extension node
 * (`sys.extension.outline`), where they are written like any field.
 */
import { firstBool, type NodeLike } from "@kb/model";
import { OUTLINE_IDS } from "./ids.ts";

/**
 * Whether a collapsed parent's bullet shows how many children it has
 * (DESIGN-UI.md → "A collapsed parent's halo says it is closed; its count
 * is a setting"); off when the node says nothing.
 */
export function showsChildCounts(family: Pick<NodeLike, "props"> | undefined): boolean {
  return family !== undefined && firstBool(OUTLINE_IDS.childCountsField)(family.props) === true;
}
