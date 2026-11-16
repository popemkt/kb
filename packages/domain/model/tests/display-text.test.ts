/**
 * A node's display text (`display-text.ts`): one rule for what a reference
 * reads as, and one plain reading of a text, over the inline grammar.
 */
import { describe, expect, test } from "bun:test";
import {
  IndexedNodes,
  SYSTEM_IDS,
  markupWords,
  nodeName,
  plainWords,
  refName,
  seededField,
  seededTag,
  type KbNode,
  type PropValue,
} from "../src/index.ts";

const AT = "2026-11-16T00:00:00.000Z";
const ref = (v: string): PropValue => ({ t: "ref", v });
const str = (v: string): PropValue => ({ t: "str", v });
const node = (id: string, text: string, props: KbNode["props"] = {}) =>
  ({ id, text, props, children: [], createdAt: AT, updatedAt: AT }) satisfies KbNode;

const titled = seededTag("t.person", "person", ["f.role"], AT);
const graph = IndexedNodes.of([
  seededField(SYSTEM_IDS.tagTitleField, "title", "text", AT, { one: true }),
  seededField("f.role", "role", "text", AT, { one: true }),
  {
    ...titled,
    props: {
      ...titled.props,
      [SYSTEM_IDS.tagTitleField]: [str("[[sys.f.node.text]] (**[[f.role]]**)")],
    },
  },
  node("rob", "Rob"),
  node("bold", "**Bo** `b`"),
  node("empty", ""),
  node("loop", "see [[loop]]"),
  node("ann", "Ann", { [SYSTEM_IDS.typeField]: [ref("t.person")], "f.role": [str("lead")] }),
]);
const nodeOf = (id: string) => graph.get(id);

describe("what a reference reads as", () => {
  test("its label, trimmed, when it has one", () => {
    expect(refName("rob", " Robert ", nodeOf)).toBe("Robert");
    expect(refName("gone", "Ghost", nodeOf)).toBe("Ghost");
  });

  test("else its target's name, in plain words", () => {
    expect(refName("rob", undefined, nodeOf)).toBe("Rob");
    expect(refName("rob", "  ", nodeOf)).toBe("Rob");
    expect(refName("bold", undefined, nodeOf)).toBe("Bo b");
    expect(refName("ann", undefined, nodeOf)).toBe("Ann (lead)");
  });

  test("its id when the target is gone, Untitled when it has no words", () => {
    expect(refName("gone", undefined, nodeOf)).toBe("gone");
    expect(refName("empty", undefined, nodeOf)).toBe("Untitled");
  });

  test("a bare reference that comes back to itself ends at its id", () => {
    expect(refName("loop", undefined, nodeOf)).toBe("see loop");
  });
});

describe("a text as plain words", () => {
  test("references read by refName", () => {
    expect(plainWords("Check up with [[rob|Rob]]", nodeOf)).toBe("Check up with Rob");
    expect(plainWords("Call [[rob]] today", nodeOf)).toBe("Call Rob today");
    expect(plainWords("Ask [[gone|Ghost]] and [[gone]]", nodeOf)).toBe("Ask Ghost and gone");
  });

  test("markup reads as its words: emphasis, code, links and media", () => {
    expect(plainWords("Run `kb docs` and keep snake_case", nodeOf)).toBe(
      "Run kb docs and keep snake_case",
    );
    expect(plainWords("_em_ and **strong**, 2 * 3 * 4", nodeOf)).toBe("em and strong, 2 * 3 * 4");
    expect(plainWords("Read [the guide](https://example.com/guide) first", nodeOf)).toBe(
      "Read the guide first",
    );
    expect(plainWords("see https://example.com/a_b", nodeOf)).toBe("see https://example.com/a_b");
    expect(plainWords("![storm at dawn](assets/storm.png)", nodeOf)).toBe("storm at dawn");
  });

  test("whitespace, line breaks included, reads as one space", () => {
    expect(plainWords("  one\n two\t three  ", nodeOf)).toBe("one two three");
  });
});

describe("a node's name", () => {
  test("is its title read plain", () => {
    expect(nodeName("ann", nodeOf)).toBe("Ann (lead)");
    expect(nodeName("bold", nodeOf)).toBe("Bo b");
  });

  test("is empty for a node with no words or no node", () => {
    expect(nodeName("empty", nodeOf)).toBe("");
    expect(nodeName("gone", nodeOf)).toBe("");
  });
});

describe("reference forms", () => {
  const nodes = new Map([
    ["n1", { text: "Ada **L**", props: {} }],
    ["n2", { text: "a ] b", props: {} }],
  ]);
  const formsOf = (id: string) => nodes.get(id);

  test("markupWords keeps the markup and writes each reference the grammar reads in its form", () => {
    const text = "see **x** [[n1]] and [[n1|the one]], not `[[n1]]`";
    expect(markupWords(text, formsOf)).toBe("see **x** Ada L and the one, not `[[n1]]`");
    expect(markupWords(text, formsOf, "link")).toBe(
      "see **x** [[Ada L]] and [[the one]], not `[[n1]]`",
    );
    expect(markupWords(text, formsOf, "id")).toBe(text);
  });

  test("a link cannot hold brackets or a bar, so such words are written as words", () => {
    expect(markupWords("[[n2]]", formsOf, "link")).toBe("a ] b");
    expect(markupWords("[[n1|x|y]]", formsOf, "link")).toBe("x|y");
  });

  test("plainWords takes the form too", () => {
    expect(plainWords("**hi** [[n1]]", formsOf, "link")).toBe("hi [[Ada L]]");
    expect(plainWords("**hi** [[n1]]", formsOf, "id")).toBe("hi [[n1]]");
  });
});
