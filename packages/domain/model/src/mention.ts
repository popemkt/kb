import { inlineSpanSource, parseInlineSource, refTokenAt } from "./inline.ts";
import type { NodeId } from "./model.ts";

/**
 * The references a text makes, read from the inline grammar (`inline.ts`,
 * the reference token's one statement): `:node/mentions` and the text writes
 * see exactly the refs the page draws, so a token inside inline code is
 * code, not a mention.
 *
 * The `[[` completion scan in `@kb/ui-sdk`'s `lib/refs.ts` is a different
 * concept and does not belong here: it looks for an *open* token — a `[[`
 * the person is still typing, with no `]]` yet — which this grammar by
 * definition never matches.
 */

/** One token as it sits in a text: its span, its target and its label. */
export interface MentionSpan {
  /** Index of the first `[`. */
  start: number;
  /** Index just past the closing `]]`. */
  end: number;
  /** The target as written, surrounding whitespace trimmed. */
  id: NodeId;
  /** The text after `|`; `undefined` for a bare `[[id]]`. */
  label: string | undefined;
}

/** Every token in `text`, in order, with repeats. */
export function mentionSpans(text: string): MentionSpan[] {
  if (!text.includes("[[")) return [];
  const out: MentionSpan[] = [];
  let at = 0;
  for (const span of parseInlineSource(text)) {
    const source = inlineSpanSource(span);
    const token = span.seg.t === "ref" ? refTokenAt(source, 0) : null;
    if (token) out.push({ start: at, end: at + source.length, id: token.id, label: token.label });
    at += source.length;
  }
  return out;
}

/** The ids `text` mentions, in order, with repeats. */
export function extractMentions(text: string): NodeId[] {
  return mentionSpans(text).map((span) => span.id);
}

/** `text` with each token replaced by what `replace` makes of it. */
export function replaceMentions(text: string, replace: (span: MentionSpan) => string): string {
  let out = "";
  let at = 0;
  for (const span of mentionSpans(text)) {
    out += text.slice(at, span.start) + replace(span);
    at = span.end;
  }
  return out + text.slice(at);
}
