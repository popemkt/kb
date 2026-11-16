/**
 * JSON (DESIGN.md → Outline formats): the tree itself, the strings the
 * grammar formats hold kept exactly, so nothing a node's text says is read
 * as a tag, a field or a directive. It loses nothing, which is why kb's own
 * clipboard flavour is it.
 */
import { Result, Schema } from "effect";
import { markupWords } from "@kb/model";
import type { OutlineItem, OutlineParse } from "./outline.ts";
import { indentUnit, type WriteOptions } from "./write.ts";

/** One item as JSON holds it; every key but `text` may be left out. */
interface JsonItem {
  readonly text: string;
  readonly tags?: readonly string[];
  readonly fields?: readonly { readonly name: string; readonly values: readonly string[] }[];
  readonly children?: readonly JsonItem[];
}

const JsonItemSchema: Schema.Codec<JsonItem> = Schema.Struct({
  text: Schema.String,
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  fields: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, values: Schema.Array(Schema.String) })),
  ),
  children: Schema.optionalKey(Schema.Array(Schema.suspend(() => JsonItemSchema))),
});

const decodeTree = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Array(JsonItemSchema)));

/** The tree JSON holds, each item's line its place in tree order, from 1. */
export function readJson(source: string): OutlineParse {
  const decoded = decodeTree(source);
  if (Result.isFailure(decoded)) {
    return { ok: false, line: 1, reason: `not an outline as JSON: ${decoded.failure.message}` };
  }
  let line = 0;
  const toItem = (item: JsonItem): OutlineItem => {
    line += 1;
    const at = line;
    return {
      line: at,
      text: item.text,
      tags: [...(item.tags ?? [])],
      fields: (item.fields ?? []).map((field) => ({
        line: at,
        name: field.name,
        values: field.values.map((raw) => ({ line: at, raw })),
      })),
      children: (item.children ?? []).map(toItem),
    };
  };
  return { ok: true, items: decoded.success.map(toItem) };
}

/** The tree as JSON, each text and value with its references in their form, empty lists left out. */
export function writeJson(items: readonly OutlineItem[], options: WriteOptions): string {
  const words = (text: string) => markupWords(text, options.nodeOf, options.refs);
  const toJson = (item: OutlineItem): JsonItem => ({
    text: words(item.text),
    ...(item.tags.length > 0 ? { tags: item.tags } : {}),
    ...(item.fields.length > 0
      ? {
          fields: item.fields.map((field) => ({
            name: field.name,
            values: field.values.map((value) => words(value.raw)),
          })),
        }
      : {}),
    ...(item.children.length > 0 ? { children: item.children.map(toJson) } : {}),
  });
  return JSON.stringify(items.map(toJson), null, indentUnit(options));
}
