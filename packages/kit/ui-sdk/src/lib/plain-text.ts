/**
 * A node's text as plain words: what a person reads in it, with no markup.
 * References read as their labels, or as the text of the node they point at
 * when they carry none; links as their words; media and markup are dropped.
 */
import { replaceMentions } from "@kb/model";

/** `text` as plain words, a bare reference read as `textOf` its target. */
export function plainText(text: string, textOf: (id: string) => string | undefined): string {
  const named = replaceMentions(text, (span) => span.label ?? textOf(span.id) ?? "");
  return named
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/^\s*(?:#+|[-*+]|\d+\.)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}
