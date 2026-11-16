/**
 * A text selection copied out of a row (DESIGN-UI.md → Outline editor,
 * "Copy, cut and Copy as…"): its source, which md-edit's `selectedSpan`
 * reads from both ends of the range, as three flavours, so another program
 * gets words and kb gets its tokens.
 */
import { markupWords, type NodeId, type NodeLike } from "@kb/model";
import { inlineHtml } from "@kb/outline-paste";
import type { ClipboardFlavours } from "./copy";

/** The flavour a text selection puts for kb itself: its source, references as tokens. */
export const KB_TEXT_TYPE = "application/x-kb-text";

/** What a copy of `source`, some text's markup and tokens, puts: its words, its rich text and itself. */
export function textFlavours(
  source: string,
  nodeOf: (id: NodeId) => Pick<NodeLike, "text" | "props"> | undefined,
): ClipboardFlavours {
  return {
    "text/plain": markupWords(source, nodeOf, "label"),
    "text/html": inlineHtml(source, { refs: "label", indent: "spaces", nodeOf }),
    [KB_TEXT_TYPE]: source,
  };
}
