import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, present, type KbNode, type NodeWrite } from "@kb/model";
import { DAYS_IDS } from "../src/ids";
import { periodKeyRefusal } from "../src/period-key";

const AT = "2026-11-11T00:00:00.000Z";

const tag = (id: string, extendsTag?: string): KbNode => ({
  id,
  text: id,
  createdAt: AT,
  updatedAt: AT,
  props:
    extendsTag === undefined ? {} : { [SYSTEM_IDS.extendsField]: [{ t: "ref", v: extendsTag }] },
  children: [],
});

const TAGS = new Map<string, KbNode>(
  [
    tag(DAYS_IDS.dayTag),
    tag(DAYS_IDS.weekTag),
    tag(DAYS_IDS.yearTag),
    tag("t.myday", DAYS_IDS.dayTag),
    tag("t.note"),
  ].map((t) => [t.id, t]),
);
const nodeOf = (id: string) => TAGS.get(id);

function node(id: string, tags: readonly string[], key?: string): KbNode {
  return {
    id,
    text: id,
    createdAt: AT,
    updatedAt: AT,
    props: {
      ...(tags.length === 0
        ? {}
        : { [SYSTEM_IDS.typeField]: tags.map((v) => ({ t: "ref" as const, v })) }),
      ...(key === undefined ? {} : { [DAYS_IDS.keyField]: [{ t: "str" as const, v: key }] }),
    },
    children: [],
  };
}

const made = (after: KbNode): NodeWrite => ({ before: undefined, after });

/** `node` with `values` as its stored key, exactly as written. */
function keyed(id: string, tags: readonly string[], values: KbNode["props"][string]): KbNode {
  const base = node(id, tags);
  return { ...base, props: { ...base.props, [DAYS_IDS.keyField]: values } };
}
const refusal = (...writes: NodeWrite[]) => periodKeyRefusal(writes, nodeOf);

describe("periodKeyRefusal", () => {
  test("a key in its period's form, on its period, is admitted", () => {
    expect(refusal(made(node("d", [DAYS_IDS.dayTag], "2026-11-11")))).toBeNull();
    expect(refusal(made(node("w", [DAYS_IDS.weekTag], "2026-W46")))).toBeNull();
    expect(refusal(made(node("w53", [DAYS_IDS.weekTag], "2026-W53")))).toBeNull();
    expect(refusal(made(node("y", [DAYS_IDS.yearTag], "2026")))).toBeNull();
    // A tag that extends #day is a day too.
    expect(refusal(made(node("m", ["t.myday"], "2026-11-11")))).toBeNull();
  });

  test("a key not in its period's form is refused, saying the form", () => {
    expect(refusal(made(node("d", [DAYS_IDS.dayTag], "2026-02-30")))).toBe(
      "“2026-02-30” is not a day: a day's period is a date, YYYY-MM-DD",
    );
    expect(refusal(made(node("d", [DAYS_IDS.dayTag], "2026-W46")))).toContain("is not a day");
    // 2027 has 52 ISO weeks.
    expect(refusal(made(node("w", [DAYS_IDS.weekTag], "2027-W53")))).toBe(
      "“2027-W53” is not a week: a week's period is an ISO week, YYYY-Www",
    );
    expect(refusal(made(node("y", [DAYS_IDS.yearTag], "26")))).toContain("is not a year");
  });

  test("a key on a node that is no period, or two, is refused", () => {
    expect(refusal(made(node("n", ["t.note"], "2026-11-11")))).toBe(
      "“n” holds the period “2026-11-11”, but only a node that is one #day, #week or #year has a period",
    );
    expect(refusal(made(node("n", [], "2026-11-11")))).toContain("only a node that is one");
    expect(
      refusal(made(node("both", [DAYS_IDS.dayTag, DAYS_IDS.weekTag], "2026-11-11"))),
    ).toContain("only a node that is one");
  });

  test("re-keying a day to another real date is a correction, and is admitted", () => {
    const before = node("d", [DAYS_IDS.dayTag], "2026-11-11");
    expect(refusal({ before, after: node("d", [DAYS_IDS.dayTag], "2026-11-12") })).toBeNull();
  });

  test("retagging a keyed node is looked at; an untouched key is not", () => {
    const day = node("d", [DAYS_IDS.dayTag], "2026-11-11");
    expect(refusal({ before: day, after: node("d", [DAYS_IDS.weekTag], "2026-11-11") })).toContain(
      "is not a week",
    );
    // A stored key the write does not touch is never re-judged.
    const odd = node("n", ["t.note"], "2026-11-11");
    expect(refusal({ before: odd, after: { ...odd, text: "renamed" } })).toBeNull();
  });

  test("a key is judged as stored: blank, padded or not text is refused, none is none", () => {
    const day = (values: KbNode["props"][string]) =>
      refusal(made(keyed("d", [DAYS_IDS.dayTag], values)));
    expect(day([{ t: "str", v: "   " }])).toBe(
      "“   ” is not a day: a day's period is a date, YYYY-MM-DD",
    );
    expect(day([{ t: "str", v: " 2026-11-11" }])).toContain("is not a day");
    expect(day([{ t: "str", v: "" }])).toContain("is not a day");
    expect(day([{ t: "num", v: 2026 }])).toContain("is not a day");
    expect(day([])).toBeNull();
    // Taking the key off is not a malformed key.
    const holder = node("d", [DAYS_IDS.dayTag], "2026-11-11");
    expect(refusal({ before: holder, after: node("d", [DAYS_IDS.dayTag]) })).toBeNull();
  });

  test("a tag that stops extending #day leaves its keyed nodes no period, and is refused", () => {
    const holder = node("h", ["t.myday"], "2026-11-11");
    const before = present(TAGS.get("t.myday"), "the custom tag");
    const after = tag("t.myday");
    const nodeOfAfter = (id: string) => (id === "t.myday" ? after : TAGS.get(id));
    expect(periodKeyRefusal([{ before, after }], nodeOfAfter, [holder])).toContain(
      "“h” holds the period “2026-11-11”, but only a node that is one",
    );
    // Moving a tag no keyed node wears judges them all and finds nothing.
    const note = present(TAGS.get("t.note"), "a plain tag");
    const extendNote = { before: note, after: tag("t.note", DAYS_IDS.yearTag) };
    expect(periodKeyRefusal([extendNote], nodeOf, [holder])).toBeNull();
  });
});
