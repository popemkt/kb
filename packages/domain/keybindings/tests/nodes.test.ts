import { expect, test } from "bun:test";
import {
  SHORTCUT_IDS,
  chordNode,
  chordOfNode,
  chordData,
  keyboardNodes,
  keyboardOptions,
  keyTargetNodeId,
  normalizedCall,
  type KeyboardDefinition,
  type Chord,
} from "../src/index.ts";

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

test("binding and chord namespaces stay disjoint for arbitrary binding suffixes", () => {
  const definition: KeyboardDefinition = {
    bindings: ["a", "a.keys", "a.keys.keys"].map((id) => ({
      id,
      value: { context: "example.editing", chord: { key: id }, run: { intent: "split" } },
    })),
  };
  const rows = keyboardNodes("example", definition, at);
  expect(rows).toHaveLength(6);
  expect(new Set(rows.map(({ id }) => id)).size).toBe(rows.length);
});

test("intent choices name the complete context vocabulary, independently of default bindings", () => {
  const definition: KeyboardDefinition = {
    contexts: [
      { id: "editing", value: { reach: "surface", intents: ["split", "unbound"], reserved: [] } },
    ],
    bindings: ["enter", "ctrl-enter"].map((id) => ({
      id,
      value: { context: "example.editing", chord: { key: "Enter" }, run: { intent: "split" } },
    })),
  };
  const rows = keyboardNodes("example", definition, at).filter(
    (row) => row.props[SHORTCUT_IDS.runs] !== undefined,
  );
  const target = keyTargetNodeId("example", "example.editing", { intent: "split" });
  expect(rows.map((row) => row.props[SHORTCUT_IDS.runs])).toEqual([
    [{ t: "ref", v: target }],
    [{ t: "ref", v: target }],
  ]);
  const options = keyboardOptions("example", definition).flatMap((set) =>
    set.options.map((option) => set.kind.prefix + option.id),
  );
  expect(options).toContain(target);
  expect(options).toContain(keyTargetNodeId("example", "example.editing", { intent: "unbound" }));
  expect(keyboardOptions("example", { ...definition, bindings: [] })).toEqual(
    keyboardOptions("example", definition),
  );
  expect(keyTargetNodeId("example", "a:b", { intent: "c" })).not.toBe(
    keyTargetNodeId("example", "a", { intent: "b:c" }),
  );
  expect(keyTargetNodeId("example", "a%3Ab", { intent: "c" })).not.toBe(
    keyTargetNodeId("example", "a:b", { intent: "c" }),
  );
  expect(keyTargetNodeId("example", "example.editing", { command: "sys.cmd.unbound" })).toBe(
    "sys.cmd.unbound",
  );
});

test("generated action recipes share semantic identity within their declaration and preserve full object input", () => {
  const first = { action: "example.run", input: { b: [1, false], a: { x: "yes" } } };
  const equal = { action: "example.run", input: { a: { x: "yes" }, b: [1, false] } };
  const definition: KeyboardDefinition = {
    bindings: [first, equal].map((run, index) => ({
      id: String(index),
      value: { context: "example.editing", chord: { key: "x" }, run },
    })),
  };
  const rows = keyboardNodes("example", definition, at);
  const calls = rows.filter(
    (row) =>
      row.props["sys.f.type"]?.some((v) => v.t === "ref" && v.v === SHORTCUT_IDS.call) === true,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]?.props[SHORTCUT_IDS.input]).toEqual([
    { t: "str", v: '{"a":{"x":"yes"},"b":[1,false]}' },
  ]);
  expect(keyTargetNodeId("example", "example.editing", first)).toBe(
    keyTargetNodeId("example", "example.editing", equal),
  );
  expect(keyTargetNodeId("example", "example.editing", first)).not.toBe(
    keyTargetNodeId("example", "example.editing", { ...first, input: { a: 2 } }),
  );
  const normalized = normalizedCall(first);
  first.input.a.x = "changed";
  expect(normalized.input).toEqual(equal.input);
  expect(normalizedCall({ action: "example.run" }).input).toEqual({});
});

test("non-object and non-JSON input recipes are rejected without losing data", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const input of [
    new Date("2026-01-01T00:00:00Z"),
    new Map([["x", 1]]),
    new Set([1]),
    null,
    1,
    "x",
    [],
    { bad: 1n },
    { bad: undefined },
    { bad: () => true },
    { bad: Infinity },
    { bad: new Date() },
    cyclic,
  ]) {
    // The public call boundary remains an object; imports still need runtime validation.
    expect(() =>
      normalizedCall({ action: "example.run", input: input as Readonly<Record<string, unknown>> }),
    ).toThrow();
  }
});
