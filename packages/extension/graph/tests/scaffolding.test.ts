/** What the graph draws: everything but the scaffolding (`@kb/model`'s `isScaffolding`), tags included. */
import { describe, expect, test } from "bun:test";
import { visibleNodes } from "../src/index.ts";
import { node } from "./fixtures.ts";

const typed = (id: string, type: string) =>
  node({ id, text: id, props: { "sys.f.type": [{ t: "ref", v: type }] } });

describe("visibleNodes", () => {
  const nodes = [
    node({ id: "sys.views", text: "Views" }),
    typed("c", "sys.command"),
    typed("f", "sys.field"),
    typed("t", "sys.tag"),
    typed("a", "t"),
    node({ id: "b", text: "B" }),
  ];

  test("draws a tag as it draws any node, and leaves out system nodes, commands and fields", () => {
    expect(visibleNodes(nodes).map((n) => n.id)).toEqual(["t", "a", "b"]);
  });

  test("draws everything when asked for the scaffolding", () => {
    expect(visibleNodes(nodes, { includeSystem: true })).toHaveLength(nodes.length);
  });
});
