/**
 * A node's description (DESIGN.md → Data model → descriptions): the value
 * of `sys.f.description`, read by `descriptionOf`, its one reader, which a
 * row, a page's head, a picker's hint and a search result all draw.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, descriptionOf, descriptionValueOf, type PropValue } from "../src/index.ts";

const holding = (...values: PropValue[]) => ({ props: { [SYSTEM_IDS.descriptionField]: values } });

describe("descriptionOf", () => {
  test("reads a node's description, trimmed", () => {
    expect(descriptionOf(holding({ t: "str", v: "  What the node is for \n" }))).toBe(
      "What the node is for",
    );
  });

  test("is nothing for a node with none, a blank one, or no node", () => {
    expect(descriptionOf({ props: {} })).toBeNull();
    expect(descriptionOf(holding({ t: "str", v: "   " }))).toBeNull();
    expect(descriptionOf(undefined)).toBeNull();
  });

  test("reads only text: a value of another kind is no description", () => {
    expect(descriptionOf(holding({ t: "ref", v: "n.other" }))).toBeNull();
  });
});

describe("descriptionValueOf", () => {
  test("is the value as stored, space and all, so a removal can name it", () => {
    expect(descriptionValueOf(holding({ t: "str", v: "  padded  " }))).toEqual({
      t: "str",
      v: "  padded  ",
    });
    expect(descriptionValueOf({ props: {} })).toBeNull();
    expect(descriptionValueOf(holding({ t: "ref", v: "n.other" }))).toBeNull();
  });
});
