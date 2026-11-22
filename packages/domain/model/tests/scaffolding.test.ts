/** The store's scaffolding, which content surfaces leave out: `sys.*` nodes and the schema and command kinds. */
import { describe, expect, test } from "bun:test";
import { isScaffolding } from "../src/index.ts";

const typed = (id: string, type: string) => ({
  id,
  props: { "sys.f.type": [{ t: "ref" as const, v: type }] },
});

describe("isScaffolding", () => {
  test("a sys.* node, a command, a tag and a field are scaffolding", () => {
    expect(isScaffolding({ id: "sys.views", props: {} })).toBe(true);
    expect(isScaffolding(typed("c", "sys.command"))).toBe(true);
    expect(isScaffolding(typed("t", "sys.tag"))).toBe(true);
    expect(isScaffolding(typed("f", "sys.field"))).toBe(true);
  });

  test("content is not, whatever it is tagged", () => {
    expect(isScaffolding(typed("a", "t.todo"))).toBe(false);
    expect(isScaffolding({ id: "b", props: {} })).toBe(false);
  });
});
