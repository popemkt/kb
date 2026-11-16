/**
 * The writers beside the readers (DESIGN.md → Outline formats): what each
 * format writes of a tree, and that reading it back gives the tree written.
 */
import { describe, expect, test } from "bun:test";
import {
  OUTLINE_FORMATS,
  outlineFormat,
  parseOutline,
  type OutlineFormatId,
  type OutlineItem,
  type WriteOptions,
} from "../src/index.ts";

type Spec = { text: string; tags?: string[]; fields?: [string, string[]][]; children?: Spec[] };

/** A tree from a compact spec, every line 0: the writers never read it. */
function tree(specs: readonly Spec[]): OutlineItem[] {
  return specs.map((spec) => ({
    line: 0,
    text: spec.text,
    tags: spec.tags ?? [],
    fields: (spec.fields ?? []).map(([name, values]) => ({
      line: 0,
      name,
      values: values.map((raw) => ({ line: 0, raw })),
    })),
    children: tree(spec.children ?? []),
  }));
}

/** A tree with its source lines dropped, to compare what was read with what was written. */
function bare(items: readonly OutlineItem[]): unknown {
  return items.map((item) => ({
    text: item.text,
    tags: item.tags,
    fields: item.fields.map((field) => ({
      name: field.name,
      values: field.values.map((v) => v.raw),
    })),
    children: bare(item.children),
  }));
}

const SOURCE: WriteOptions = { refs: "id", indent: "spaces", nodeOf: () => undefined };

/** A graph of one node, the one SAMPLE references. */
const adaOf = (id: string) =>
  id === "01KZ0000000000000000000000" ? { text: "Ada", props: {} } : undefined;

const SAMPLE = tree([
  {
    text: "Plan **the** trip [[01KZ0000000000000000000000|Ada]]",
    tags: ["todo", "two words"],
    fields: [
      ["status", ["doing"]],
      ["owners", ["[[01KZ0000000000000000000000]]", "Bob"]],
    ],
    children: [{ text: "Book", children: [{ text: "" }] }],
  },
  { text: "Second" },
]);

describe("Tana Paste", () => {
  const tana = outlineFormat("tana");

  test("writes the header, `- ` items, tags after the text and fields as items", () => {
    expect(tana.write(SAMPLE, SOURCE)).toBe(
      [
        "%%tana%%",
        "- Plan **the** trip [[01KZ0000000000000000000000|Ada]] #todo #[[two words]]",
        "  - status:: doing",
        "  - owners::",
        "    - [[01KZ0000000000000000000000]]",
        "    - Bob",
        "  - Book",
        "    -",
        "- Second",
      ].join("\n"),
    );
  });

  test("reads back to the tree it wrote", () => {
    const read = parseOutline(tana.write(SAMPLE, SOURCE));
    expect(read.ok && bare(read.items)).toEqual(bare(SAMPLE));
  });

  test("indents with tabs when asked", () => {
    const written = tana.write(SAMPLE, { ...SOURCE, indent: "tabs" });
    expect(written.split("\n")[2]).toBe("\t- status:: doing");
    const read = parseOutline(written);
    expect(read.ok && bare(read.items)).toEqual(bare(SAMPLE));
  });

  test("a line break, which Tana Paste cannot say, is a space", () => {
    expect(tana.write(tree([{ text: "one\ntwo" }]), SOURCE)).toBe("%%tana%%\n- one two");
  });
});

/** Read `text` back through format `id`'s own reader. */
function readBack(id: OutlineFormatId, text: string): unknown {
  const read = outlineFormat(id).read?.(text);
  if (read === undefined) throw new Error(`${id} has no reader`);
  if (!read.ok) throw new Error(`line ${read.line}: ${read.reason}`);
  return bare(read.items);
}

describe("Markdown", () => {
  const md = outlineFormat("md");

  test("writes `- ` items, fields as Tana Paste does, and a line break as a further line", () => {
    const sample = tree([
      { text: "one\ntwo", fields: [["status", ["doing"]]], children: [{ text: "c" }] },
    ]);
    expect(md.write(sample, SOURCE)).toBe(
      ["- one", "  two", "  - status:: doing", "  - c"].join("\n"),
    );
  });

  test("reads back to the tree it wrote, line breaks included", () => {
    const sample = [...SAMPLE, ...tree([{ text: "one\ntwo", children: [{ text: "under" }] }])];
    expect(readBack("md", md.write(sample, SOURCE))).toEqual(bare(sample));
  });

  test("reads `*` and `+` bullets, a property line and a continuation line", () => {
    expect(readBack("md", "* first\n  status:: doing\n  more text\n  + child")).toEqual(
      bare(
        tree([
          {
            text: "first\nmore text",
            fields: [["status", ["doing"]]],
            children: [{ text: "child" }],
          },
        ]),
      ),
    );
  });

  test("a line without a bullet above every item is refused", () => {
    expect(outlineFormat("md").read?.("no bullet")).toEqual({
      ok: false,
      line: 1,
      reason: 'expected an item starting with "- "',
    });
  });
});

describe("Logseq", () => {
  const logseq = outlineFormat("logseq");

  test("writes a field as a property line under the block's first line", () => {
    expect(logseq.write(SAMPLE, SOURCE)).toBe(
      [
        "- Plan **the** trip [[01KZ0000000000000000000000|Ada]] #todo #[[two words]]",
        "  status:: doing",
        "  owners:: [[01KZ0000000000000000000000]], Bob",
        "  - Book",
        "    -",
        "- Second",
      ].join("\n"),
    );
  });

  test("reads back to the tree it wrote when each field holds one value", () => {
    const sample = tree([
      { text: "a\nb", tags: ["todo"], fields: [["status", ["doing"]]], children: [{ text: "c" }] },
    ]);
    expect(readBack("logseq", logseq.write(sample, SOURCE))).toEqual(bare(sample));
  });
});

describe("Plain text", () => {
  const plain = outlineFormat("plain");

  test("writes each item's plain reading, nested by indent, with no tags or fields", () => {
    expect(plain.write(SAMPLE, { ...SOURCE, refs: "label", nodeOf: adaOf })).toBe(
      ["Plan the trip Ada", "  Book", "    ", "Second"].join("\n"),
    );
  });

  test("reads every line as an item, nothing in it a tag or a field", () => {
    expect(readBack("plain", "a #todo\n  status:: doing\n  - c")).toEqual(
      bare(tree([{ text: "a #todo", children: [{ text: "status:: doing" }, { text: "- c" }] }])),
    );
  });
});

describe("Rich text", () => {
  const html = outlineFormat("html");

  test("writes one nested list, fields before the children and tags after the text", () => {
    expect(html.write(SAMPLE.slice(0, 1), { ...SOURCE, refs: "label", nodeOf: adaOf })).toBe(
      "<ul><li>Plan <strong>the</strong> trip Ada #todo #two words<ul>" +
        "<li><em>status</em>: doing</li><li><em>owners</em>: Ada, Bob</li>" +
        "<li>Book<ul><li></li></ul></li></ul></li></ul>",
    );
  });

  test("escapes text, keeps an absolute link and writes any other link as its words", () => {
    expect(html.write(tree([{ text: "<a> & [x](https://e.com) [y](/node/1)" }]), SOURCE)).toBe(
      '<ul><li>&lt;a&gt; &amp; <a href="https://e.com">x</a> y</li></ul>',
    );
  });

  test("has no reader", () => {
    expect(html.read).toBeUndefined();
  });
});

describe("JSON", () => {
  const json = outlineFormat("json");

  test("keeps every string exactly, the grammar's marks included", () => {
    const sample = tree([
      {
        text: "#word name:: value\n%%tana%% [[01KZ0000000000000000000000|Ada]]",
        fields: [["status", ["a, b"]]],
        children: [{ text: "- not a bullet" }],
      },
    ]);
    expect(readBack("json", json.write(sample, SOURCE))).toEqual(bare(sample));
  });

  test("leaves empty lists out and indents by the option", () => {
    expect(json.write(tree([{ text: "a" }]), { ...SOURCE, indent: "tabs" })).toBe(
      '[\n\t{\n\t\t"text": "a"\n\t}\n]',
    );
  });

  test("refuses text that is not an outline as JSON at line 1", () => {
    const read = json.read?.('{"text": "a"}');
    expect(read?.ok).toBe(false);
    expect(read?.ok === false && read.line).toBe(1);
  });
});

describe("reference forms", () => {
  const item = tree([{ text: "see [[01KZ0000000000000000000000]]" }]);

  test("every grammar format writes a reference as its words, a link or its token", () => {
    const md = outlineFormat("md");
    expect(md.write(item, { ...SOURCE, refs: "label", nodeOf: adaOf })).toBe("- see Ada");
    expect(md.write(item, { ...SOURCE, refs: "link", nodeOf: adaOf })).toBe("- see [[Ada]]");
    expect(md.write(item, { ...SOURCE, refs: "id", nodeOf: adaOf })).toBe(
      "- see [[01KZ0000000000000000000000]]",
    );
  });
});

test("every format with a reader reads back the tree it wrote, references as ids", () => {
  const sample = tree([
    {
      text: "Plan [[01KZ0000000000000000000000]]",
      tags: ["todo"],
      fields: [["status", ["doing"]]],
    },
    { text: "Second", children: [{ text: "Third" }] },
  ]);
  for (const format of OUTLINE_FORMATS) {
    if (format.read === undefined) continue;
    const kept =
      format.id === "plain"
        ? tree([
            { text: "Plan [[01KZ0000000000000000000000]]" },
            { text: "Second", children: [{ text: "Third" }] },
          ])
        : sample;
    expect([format.id, readBack(format.id, format.write(sample, SOURCE))]).toEqual([
      format.id,
      bare(kept),
    ]);
  }
});
