/** `kb://open/<store>/<node>` is navigation only: what parses, and what does not. */
import { describe, expect, test } from "bun:test";
import { nodePagePath, parseDeepLink } from "../src/index.ts";

describe("parseDeepLink", () => {
  test("a store and a node", () => {
    expect(
      parseDeepLink("kb://open/01M7QSY933AGWWK11NDYJB7P1D/01M7QT0000AAAAAAAAAAAAAAAA"),
    ).toEqual({
      store: "01M7QSY933AGWWK11NDYJB7P1D",
      node: "01M7QT0000AAAAAAAAAAAAAAAA",
    });
  });

  test("a store alone opens its page as it was", () => {
    expect(parseDeepLink("kb://open/Personal")).toEqual({ store: "Personal", node: null });
    expect(parseDeepLink("kb://open/Personal/")).toEqual({ store: "Personal", node: null });
  });

  test("a store name may be escaped", () => {
    expect(parseDeepLink("kb://open/My%20Notes/sys.tag.todo")).toEqual({
      store: "My Notes",
      node: "sys.tag.todo",
    });
  });

  test("anything else opens nothing", () => {
    for (const url of [
      "https://example.com/open/a/b",
      "kb://write/a/b",
      "kb://open",
      "kb://open/a/b/c",
      "kb://open/a/..%2F..",
      "kb://open/a/x%3Fy",
      "not a url",
    ]) {
      expect(parseDeepLink(url), url).toBeNull();
    }
  });

  test("the node's page path", () => {
    expect(nodePagePath("01ABC")).toBe("/node/01ABC");
  });
});
