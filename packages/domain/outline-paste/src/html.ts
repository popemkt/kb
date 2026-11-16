/**
 * Rich text (DESIGN.md → Outline formats): the tree as a nested `<ul>` for a
 * document, a chat or mail to paste as a list. Write only: no HTML reader
 * runs in the isomorphic domain. Emphasis and code are the elements the
 * editor draws them as (`FORMATTED`); a safe absolute link is a link;
 * media and any other link are their words, since an asset path or a page
 * route means nothing outside kb; a reference is written in its form.
 */
import { markupWords, parseInlineSource, type InlineSpan } from "@kb/model";
import type { OutlineItem } from "./outline.ts";
import type { WriteOptions } from "./write.ts";

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** `text` safe in an element or a quoted attribute; a line break is a `<br>`. */
function escaped(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ESCAPES[ch] ?? ch).replace(/\n/g, "<br>");
}

/**
 * The open and close tags of each formatted span, as md-edit's element tree
 * draws it; a ui-sdk test holds the two to one answer.
 */
// GAP [[01M7HSNPHW2Z613ZR7CC8CM5TW]]
const FORMATTED: Readonly<Record<"bold" | "italic" | "codeSpan", readonly [string, string]>> = {
  bold: ["<strong>", "</strong>"],
  italic: ["<em>", "</em>"],
  codeSpan: ["<code>", "</code>"],
};

/** A link another program can follow: http(s) or mail, never a path inside kb. */
const ABSOLUTE_LINK = /^(https?:\/\/|mailto:)/i;

function spanHtml(span: InlineSpan, options: WriteOptions): string {
  const { seg } = span;
  switch (seg.t) {
    case "text":
      return escaped(seg.v);
    case "bold":
    case "italic":
    case "codeSpan": {
      const [open, close] = FORMATTED[seg.t];
      return `${open}${escaped(seg.v)}${close}`;
    }
    case "link":
      return ABSOLUTE_LINK.test(seg.href)
        ? `<a href="${escaped(seg.href)}">${escaped(seg.label)}</a>`
        : escaped(seg.label);
    case "media":
      return escaped(seg.alt);
    case "ref":
      return escaped(markupWords(span.open, options.nodeOf, options.refs));
    default: {
      const unhandled: never = seg;
      throw new Error(`unhandled inline segment: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** A text of node or value as rich text: its spans, each drawn. */
export function inlineHtml(text: string, options: WriteOptions): string {
  return parseInlineSource(text)
    .map((span) => spanHtml(span, options))
    .join("");
}

function itemHtml(item: OutlineItem, options: WriteOptions): string {
  const tags = item.tags.map((tag) => ` #${escaped(tag)}`).join("");
  const fields = item.fields.map(
    (field) =>
      `<li><em>${escaped(field.name)}</em>: ${field.values
        .map((value) => inlineHtml(value.raw, options))
        .join(", ")}</li>`,
  );
  const children = item.children.map((child) => itemHtml(child, options));
  const under = [...fields, ...children];
  return `<li>${inlineHtml(item.text, options)}${tags}${under.length === 0 ? "" : `<ul>${under.join("")}</ul>`}</li>`;
}

/** The tree as one nested list. */
export function writeHtml(items: readonly OutlineItem[], options: WriteOptions): string {
  return `<ul>${items.map((item) => itemHtml(item, options)).join("")}</ul>`;
}
