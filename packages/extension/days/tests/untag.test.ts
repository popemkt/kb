/**
 * Taking a period's tag off takes its key with it (DESIGN.md → Days): the
 * interceptor adds the key's unset to a `node.update` that leaves a keyed
 * day, week or year no period, and leaves every other update as given.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import { DAYS_IDS } from "../src/ids";
import { untaggedInput } from "../src/untag";

const AT = "2026-11-11T00:00:00.000Z";

function node(id: string, text: string, props: KbNode["props"] = {}): KbNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}

const typeRef = (v: string) => ({ t: "ref" as const, v });
const tagged = (...tags: string[]) => ({ [SYSTEM_IDS.typeField]: tags.map(typeRef) });

const NODES: KbNode[] = [
  node(SYSTEM_IDS.typeField, "type", tagged(SYSTEM_IDS.field)),
  node(DAYS_IDS.keyField, "period", tagged(SYSTEM_IDS.field)),
  node(DAYS_IDS.dayTag, "day", tagged(SYSTEM_IDS.tag)),
  node(DAYS_IDS.weekTag, "week", tagged(SYSTEM_IDS.tag)),
  node("t.note", "note", tagged(SYSTEM_IDS.tag)),
  node("day", "Wed, Nov 11", {
    ...tagged(DAYS_IDS.dayTag, "t.note"),
    [DAYS_IDS.keyField]: [{ t: "str", v: "2026-11-11" }],
  }),
  node("plain", "plain", tagged("t.note")),
];
const byId = new Map(NODES.map((n) => [n.id, n]));
const untag = (input: unknown) => untaggedInput(input, NODES, (id) => byId.get(id));

const KEY_UNSET = { field: DAYS_IDS.keyField };

describe("untaggedInput", () => {
  test("taking #day off a keyed day takes its key off in the same write", () => {
    const off = {
      id: "day",
      unsetProps: [{ field: SYSTEM_IDS.typeField, value: typeRef(DAYS_IDS.dayTag) }],
    };
    expect(untag(off)).toEqual({ ...off, unsetProps: [...off.unsetProps, KEY_UNSET] });
    // By the field's name, as the command line gives it, and by clearing every tag.
    const byName = { id: "day", unsetProps: [{ field: "type", value: typeRef(DAYS_IDS.dayTag) }] };
    expect(untag(byName)).toEqual({ ...byName, unsetProps: [...byName.unsetProps, KEY_UNSET] });
    const all = { id: "day", unsetProps: [{ field: SYSTEM_IDS.typeField }] };
    expect(untag(all)).toEqual({ ...all, unsetProps: [...all.unsetProps, KEY_UNSET] });
  });

  test("an update that leaves the node a period, or touches no keyed period, is left as given", () => {
    const other = {
      id: "day",
      unsetProps: [{ field: SYSTEM_IDS.typeField, value: typeRef("t.note") }],
    };
    expect(untag(other)).toBe(other);
    // Retagged to #week: still a period, so the week guard judges its key.
    const retag = {
      id: "day",
      unsetProps: [{ field: SYSTEM_IDS.typeField, value: typeRef(DAYS_IDS.dayTag) }],
      setProps: [{ field: SYSTEM_IDS.typeField, value: typeRef(DAYS_IDS.weekTag) }],
    };
    expect(untag(retag)).toBe(retag);
    const plain = { id: "plain", unsetProps: [{ field: SYSTEM_IDS.typeField }] };
    expect(untag(plain)).toBe(plain);
    const text = { id: "day", text: "renamed" };
    expect(untag(text)).toBe(text);
    // node.update matches an unset value by its JSON, so a ref written with
    // its keys the other way round takes nothing off, and nor does this.
    const reversed = {
      id: "day",
      unsetProps: [{ field: SYSTEM_IDS.typeField, value: { v: DAYS_IDS.dayTag, t: "ref" } }],
    };
    expect(untag(reversed)).toBe(reversed);
    // Already taking the key off: nothing to add.
    const both = { id: "day", unsetProps: [{ field: SYSTEM_IDS.typeField }, KEY_UNSET] };
    expect(untag(both)).toBe(both);
  });
});
