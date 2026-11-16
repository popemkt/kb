/**
 * What the outline claims of a paste (DESIGN-UI.md → Paste and drop): kb's
 * own rows from this store, and a list, read by the Markdown codec; never
 * prose.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { outlineFormat } from "@kb/outline-paste";
import { ingestPort, syncUiPlugins, type Ingested } from "@kb/ui-sdk";
import { testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import {
  heldTree,
  KB_OUTLINE_TYPE,
  PASTE_KB_OUTLINE,
  PASTE_LIST,
  PASTED_LIST,
} from "./outline-paste";

const claims = (text: string) => new RegExp(PASTED_LIST, "u").test(text);

/** A copy of rows makes nodes, never text. */
const noText = (text: string) => {
  throw new Error(`a copy of rows put text in: ${text}`);
};

describe("a pasted list", () => {
  it("is two or more list items, nesting by indent, blank lines between allowed", () => {
    expect(claims("- one\n- two")).toBe(true);
    expect(claims("- one\n  - nested\n- two\n")).toBe(true);
    expect(claims("* one\r\n* two\r\n")).toBe(true);
    expect(claims("+ one\n\n+ two")).toBe(true);
    expect(claims("%%tana%%\n- one\n  - status:: done\n- two")).toBe(true);
    expect(claims("- one\n-\n- three")).toBe(true);
  });

  it("is not one item, prose, or a list with prose in it", () => {
    expect(claims("- one")).toBe(false);
    expect(claims("one\ntwo")).toBe(false);
    expect(claims("Issue #12\nis fixed")).toBe(false);
    expect(claims("- one\nand then\n- two")).toBe(false);
    expect(claims("-one\n-two")).toBe(false);
    expect(claims("1. one\n2. two")).toBe(false);
    expect(claims("")).toBe(false);
  });

  it("is read by the Markdown codec as it stands, any marker and Windows line ends", () => {
    const list = "* one\r\n  + nested\r\n* two";
    const outcome = PASTE_LIST.ingest(pasted({ "text/plain": list }), SITE);
    expect(outcome).toEqual({ tree: list, format: "md" });
    const parsed = outlineFormat("md").read?.(list);
    expect(
      parsed?.ok === true && parsed.items.map(({ text, children }) => [text, children.length]),
    ).toEqual([
      ["one", 1],
      ["two", 0],
    ]);
  });
});

const SITE = { nodeId: "n.row", text: "" };

/** A paste carrying `flavours`. */
function pasted(flavours: Readonly<Record<string, string>>): Ingested {
  const { "text/plain": text = "", ...data } = flavours;
  return { gesture: "paste", types: Object.keys(flavours), text, data, files: [] };
}

describe("kb's own rows pasted", () => {
  const json = JSON.stringify([
    {
      text: "Plan [[n.ada]]",
      tags: ["t.project"],
      fields: [{ name: "f.status", values: ["[[o.doing]]"] }],
      children: [{ text: "Book" }],
    },
  ]);
  const markdown = "- Plan Ada #project\n  - status:: doing\n  - Book";
  const copy = pasted({ "text/plain": markdown, [KB_OUTLINE_TYPE]: json });
  const added: [string, string][] = [];
  const base = testBrowserHost();
  const host = testBrowserHost({
    writes: {
      ...base.writes,
      addTree: (tree, format) => {
        added.push([tree, format]);
        return Promise.resolve([]);
      },
    },
  });
  /** A store holding `ids`, and the row pasted into. */
  const holding = (ids: readonly string[]) =>
    host.setNodes(
      [...ids, SITE.nodeId].map((id) => ({
        id,
        text: id,
        parentId: null,
        children: [],
        collapsed: false,
        props: {},
        createdAt: "",
        updatedAt: "",
        tags: [],
      })),
    );
  const port = ingestPort(
    () => [PASTE_LIST, PASTE_KB_OUTLINE],
    () => SITE,
  );

  beforeAll(() => syncUiPlugins([testHostPlugin(host)]));
  afterAll(() => syncUiPlugins([]));
  beforeEach(() => {
    added.length = 0;
  });

  it("from this store are read back as JSON, losslessly, before the list they also are", async () => {
    holding(["n.ada", "t.project", "f.status", "o.doing"]);
    expect(port.offer(copy, noText)).toBe(true);
    await expect.poll(() => added).toEqual([[json, "json"]]);
  });

  it("naming a node this store lacks, as from another kb, are read from their Markdown", async () => {
    holding(["n.ada", "t.project", "f.status"]);
    expect(port.offer(copy, noText)).toBe(true);
    await expect.poll(() => added).toEqual([[markdown, "md"]]);
  });

  it("are declined when the flavour holds no tree", () => {
    expect(heldTree("not json", () => true)).toBeNull();
    expect(heldTree(json, () => true)).toBe(json);
  });
});
