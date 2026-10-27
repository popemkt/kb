/**
 * Where an item leads (`links.ts`): a link item is a card for a web page,
 * named from its address alone, and its address is where it leads; any
 * item's own link leads first.
 */
import { describe, expect, test } from "bun:test";
import {
  isLinkNode,
  itemLead,
  linkCard,
  parseCanvasDoc,
  withLink,
  stringifyCanvasDoc,
  type CanvasLinkNode,
  type CanvasNode,
} from "../src/index.ts";

const link = (url: string, more: Partial<CanvasLinkNode> = {}): CanvasLinkNode => ({
  id: "l",
  type: "link",
  url,
  x: 0,
  y: 0,
  width: 200,
  height: 70,
  ...more,
});

describe("a link item", () => {
  test("is read and written as JSON Canvas writes it", () => {
    const raw = { nodes: [link("https://example.org/a")], edges: [] };
    const doc = parseCanvasDoc(raw);
    expect(doc.nodes.map(isLinkNode)).toEqual([true]);
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
  });

  test("is named from its address: its last path segment as words, over its host", () => {
    expect(linkCard("https://www.example.org/docs/canvas-guide.html")).toEqual({
      title: "canvas guide",
      host: "example.org",
    });
    expect(linkCard("https://kb.test/")).toEqual({ title: "kb.test", host: "kb.test" });
    expect(linkCard("https://kb.test/a%20b_c/")).toEqual({ title: "a b c", host: "kb.test" });
    expect(linkCard("mailto:someone@kb.test")).toEqual({ title: "someone@kb.test", host: "mail" });
    expect(linkCard("not an address")).toEqual({ title: "not an address", host: "" });
    expect(linkCard("https://kb.test/%E0%A4%A")).toEqual({ title: "%E0%A4%A", host: "kb.test" });
  });

  test("leads to its page; an item's own link leads first; a script never", () => {
    expect(itemLead(link("https://kb.test/a"))).toEqual({ url: "https://kb.test/a" });
    expect(itemLead(link("https://kb.test/a", { link: { node: "n1" } }))).toEqual({ node: "n1" });
    expect(itemLead(link("javascript:alert(1)"))).toBeUndefined();
    expect(itemLead({ id: "t", type: "text", text: "t", x: 0, y: 0, width: 9, height: 9 })).toBe(
      undefined,
    );
  });

  test("an item's own link leads only where a link may: a script, data or empty id never", () => {
    const text: CanvasNode = { id: "t", type: "text", text: "t", x: 0, y: 0, width: 9, height: 9 };
    for (const bad of [
      { url: "javascript:alert(1)" },
      { url: "data:text/html,<script>alert(1)</script>" },
      { url: "not a url" },
      { node: "" },
      { url: "https://kb.test/a", node: "n1" },
    ]) {
      // A writer that skipped the schema: the item holds the link as it was handed over.
      expect(itemLead({ ...text, link: bad as never })).toBeUndefined();
      expect(withLink(text, bad as never).link).toBeUndefined();
    }
    expect(itemLead({ ...text, link: { url: "https://kb.test/a" } })).toEqual({
      url: "https://kb.test/a",
    });
    expect(withLink(text, { url: "mailto:a@kb.test" }).link).toEqual({ url: "mailto:a@kb.test" });
    expect(withLink(text, { node: "n1", item: "i" }).link).toEqual({ node: "n1", item: "i" });
  });
});
