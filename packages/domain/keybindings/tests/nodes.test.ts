import { expect, test } from "bun:test";
import { SHORTCUT_IDS, chordNode, chordOfNode, chordData, type Chord } from "../src/index.ts";

const at = "2026-11-11T00:00:00.000Z";

test("ordinary chord fields retain empty sets, printable exclusions and false versus wildcard modifiers", () => {
  const chords: Chord[] = [
    {},
    { key: [] },
    { key: ["a", "A"], code: "KeyA", mod: false, meta: true, ctrl: false, shift: false },
    { key: { kind: "printable", except: ["o", "O"] }, alt: false },
    { code: "Space", key: " " },
  ];
  for (const chord of chords) {
    const row = chordNode("trial", chord, at);
    row.text = "My own label";
    expect(chordOfNode(row)).toEqual(chordData(chord));
  }
  expect(chordOfNode(chordNode("wildcard", {}, at))).toEqual({});
  expect(chordOfNode(chordNode("false", { mod: false }, at))).toEqual({ mod: false });
  expect(() => chordNode("callback", { key: () => true }, at)).toThrow();
});

test("malformed imported chord fields are refused rather than broadened", () => {
  const row = chordNode("trial", { key: "a" }, at);
  expect(
    chordOfNode({
      ...row,
      props: { ...row.props, "sys.f.shortcut.mod": [{ t: "str", v: "false" }] },
    }),
  ).toBeNull();
  expect(
    chordOfNode({
      ...row,
      props: {
        ...row.props,
        "sys.f.shortcut.mod": [
          { t: "ref", v: SHORTCUT_IDS.excluded },
          { t: "ref", v: SHORTCUT_IDS.required },
        ],
      },
    }),
  ).toBeNull();
  expect(
    chordOfNode({
      ...row,
      props: { ...row.props, [SHORTCUT_IDS.matcher]: [{ t: "ref", v: "forged" }] },
    }),
  ).toBeNull();
  expect(
    chordOfNode({
      ...row,
      props: { ...row.props, [SHORTCUT_IDS.characters]: [{ t: "ref", v: "a" }] },
    }),
  ).toBeNull();
  expect(
    chordOfNode({ ...row, props: { ...row.props, [SHORTCUT_IDS.except]: [{ t: "str", v: "a" }] } }),
  ).toBeNull();
});
