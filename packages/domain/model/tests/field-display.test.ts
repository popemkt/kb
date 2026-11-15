/** Field display's one reader (DESIGN.md → Data model → field display). */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, fieldShowOf, pinnedFirst, type PropValue } from "../src/index.ts";

const props = (entries: Record<string, PropValue[]>) => ({ props: entries });
const show = (v: string) => ({ [SYSTEM_IDS.showField]: [{ t: "ref" as const, v }] });
const PINNED = { [SYSTEM_IDS.pinnedField]: [{ t: "bool" as const, v: true }] };

describe("field display", () => {
  test("show reads its option, and anything else as always", () => {
    expect(fieldShowOf(show(SYSTEM_IDS.showNever))).toBe("never");
    expect(fieldShowOf(show(SYSTEM_IDS.showFilled))).toBe("filled");
    expect(fieldShowOf(show(SYSTEM_IDS.showHidden))).toBe("hidden");
    expect(fieldShowOf(show(SYSTEM_IDS.showTucked))).toBe("tucked");
    expect(fieldShowOf(show("sys.show.unknown"))).toBe("always");
    expect(fieldShowOf({})).toBe("always");
    expect(fieldShowOf(undefined)).toBe("always");
  });

  test("the old hidden checkbox reads as hidden where show names no option, and show beats it", () => {
    const hid = { [SYSTEM_IDS.hiddenField]: [{ t: "bool" as const, v: true }] };
    expect(fieldShowOf(hid)).toBe("hidden");
    expect(fieldShowOf({ ...hid, ...show(SYSTEM_IDS.showNever) })).toBe("never");
    expect(fieldShowOf({ ...hid, ...show("sys.show.unknown") })).toBe("hidden");
    expect(fieldShowOf({ [SYSTEM_IDS.hiddenField]: [{ t: "bool", v: false }] })).toBe("always");
  });

  test("pinned fields come first, each part keeping its order", () => {
    const nodes = new Map([
      ["a", props({})],
      ["b", props(PINNED)],
      ["c", props({})],
      ["d", props(PINNED)],
    ]);
    expect(
      pinnedFirst(
        ["a", "b", "c", "d", "x"],
        (id) => id,
        (id) => nodes.get(id),
      ),
    ).toEqual(["b", "d", "a", "c", "x"]);
  });
});
