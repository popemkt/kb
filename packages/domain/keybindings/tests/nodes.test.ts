import { expect, test } from "bun:test";
import { normalizedCall } from "../src/nodes.ts";
import {
  SHORTCUT_IDS,
  chordData,
  keyboardNodes,
  keyTargetNodeId,
  type KeyboardDefinition,
  chordFromText,
  chordToText,
  type Chord,
} from "../src/index.ts";

const at = "2026-11-11T00:00:00.000Z";

test("ordinary chord fields retain empty sets, printable exclusions and false versus wildcard modifiers", () => {
  const chords: Chord[] = [
    {},
    { key: [] },
    { key: ["a", "A"], physicalKey: "KeyA", mod: false, meta: true, ctrl: false, shift: false },
    { key: { kind: "printable", except: ["o", "O"] }, alt: false },
    { physicalKey: "Space", key: " " },
  ];
  for (const chord of chords) {
    expect(chordFromText(chordToText(chord))).toEqual(chordData(chord));
  }
  expect(chordFromText(chordToText({}))).toEqual({});
  expect(chordFromText(chordToText({ mod: false }))).toEqual({ mod: false });
  expect(() => chordToText({ key: () => true })).toThrow();
});

test("malformed key text is refused rather than broadened", () => {
  for (const text of [
    '{"mod":"false"}',
    '{"mod":null}',
    '{"key":{"kind":"forged"}}',
    '{"unknown":true}',
  ]) {
    expect(chordFromText(text)).toBeNull();
  }
});

test("alternate keys share one row without binding-suffix collisions", () => {
  const definition: KeyboardDefinition = {
    bindings: ["a", "a.keys", "a.keys.keys"].map((id) => ({
      id,
      value: { context: "example.editing", chord: { key: id }, run: { intent: "split" } },
    })),
  };
  const rows = keyboardNodes("example", definition, at);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.props[SHORTCUT_IDS.keys]).toHaveLength(3);
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
  expect(rows.map((row) => row.props[SHORTCUT_IDS.runs])).toEqual([[{ t: "ref", v: target }]]);
  const commands = keyboardNodes("example", definition, at).filter(
    (row) => row.props[SHORTCUT_IDS.commandIntent] !== undefined,
  );
  expect(commands.map(({ id }) => id)).toContain(target);
  expect(commands.map(({ id }) => id)).toContain(
    keyTargetNodeId("example", "example.editing", { intent: "unbound" }),
  );
  expect(keyboardNodes("example", { ...definition, bindings: [] }, at)).toEqual(commands);
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

test("independent families describing the same call retain distinct shortcut ownership", () => {
  const definition: KeyboardDefinition = {
    bindings: [
      {
        id: "shared",
        value: {
          context: "core.page",
          chord: { key: "x", mod: true },
          run: { command: "sys.cmd.shared" },
        },
      },
    ],
  };
  const rows = [
    ...keyboardNodes("first", definition, at),
    ...keyboardNodes("second", definition, at),
  ];
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map(({ id }) => id)).size).toBe(2);
  expect(rows.map((row) => row.props[SHORTCUT_IDS.runs])).toEqual([
    [{ t: "ref", v: "sys.cmd.shared" }],
    [{ t: "ref", v: "sys.cmd.shared" }],
  ]);
});
