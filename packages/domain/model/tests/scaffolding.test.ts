/**
 * The store's scaffolding, which content surfaces leave out: `sys.*` nodes
 * and nodes of the scaffolding kinds (fields, commands). A tag is content,
 * a node like any other (DESIGN-UI.md → Outline editor, "The home outline").
 */
import { describe, expect, test } from "bun:test";
import { isScaffolding } from "../src/index.ts";

const typed = (id: string, type: string) => ({
  id,
  props: { "sys.f.type": [{ t: "ref" as const, v: type }] },
});

describe("isScaffolding", () => {
  test("a sys.* node, a command and a field are scaffolding", () => {
    expect(isScaffolding({ id: "sys.views", props: {} })).toBe(true);
    expect(isScaffolding(typed("c", "sys.command"))).toBe(true);
    expect(isScaffolding(typed("f", "sys.field"))).toBe(true);
  });

  test("a tag is content, as is any node whatever it is tagged", () => {
    expect(isScaffolding(typed("t", "sys.tag"))).toBe(false);
    expect(isScaffolding(typed("a", "t.todo"))).toBe(false);
    expect(isScaffolding({ id: "b", props: {} })).toBe(false);
  });

  test("a system tag stays scaffolding: it is a sys.* node", () => {
    expect(isScaffolding(typed("sys.tag.option", "sys.tag"))).toBe(true);
  });
});
