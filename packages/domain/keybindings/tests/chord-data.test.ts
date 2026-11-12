import { expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { ChordDataSchema, matchesChord, printableExcept, type Chord } from "../src/index.ts";

const read = Schema.decodeUnknownOption(ChordDataSchema);
const chords: readonly Chord[] = [
  { code: "NumpadEnter", mod: false },
  { key: ["k", "K"], mod: true, shift: false },
  { key: "Escape" },
  {
    key: printableExcept([{ key: ["o", "O"], mod: false, alt: false }], { mod: false, alt: false }),
    mod: false,
    alt: false,
  },
];

test("declarative chords retain matching behavior after storage, including wildcard modifiers", () => {
  for (const chord of chords) {
    const decoded = read(JSON.parse(JSON.stringify(chord)));
    expect(Option.isSome(decoded)).toBe(true);
    if (Option.isNone(decoded)) continue;
    for (const key of ["a", "o", "O", "k", "K", "Escape", "Enter", " ", "ø", "ArrowUp"]) {
      for (const code of ["NumpadEnter", "Enter", "KeyK"]) {
        for (let bits = 0; bits < 16; bits++) {
          const event = {
            key,
            code,
            metaKey: (bits & 1) !== 0,
            ctrlKey: (bits & 2) !== 0,
            shiftKey: (bits & 4) !== 0,
            altKey: (bits & 8) !== 0,
          };
          expect(matchesChord(event, decoded.value)).toBe(matchesChord(event, chord));
        }
      }
    }
  }
});

test("stored chords distinguish absent modifiers from false and refuse executable predicates", () => {
  const any = read({ key: "Enter" });
  const plain = read({ key: "Enter", mod: false });
  if (Option.isNone(any) || Option.isNone(plain)) throw new Error("valid chord refused");
  expect(matchesChord({ key: "Enter", ctrlKey: true }, any.value)).toBe(true);
  expect(matchesChord({ key: "Enter", ctrlKey: true }, plain.value)).toBe(false);
  expect(Option.isNone(read({ key: () => true }))).toBe(true);
  expect(Option.isNone(read({ mod: "false" }))).toBe(true);
});
