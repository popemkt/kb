import { expect, test } from "bun:test";
import { chordFromText, chordToText } from "../src/chord-text.ts";
import { chordData } from "../src/chord-data.ts";
import { parseChord, matchesChord, printableExcept, type Chord } from "../src/chord.ts";

test("text preserves every chord constraint through the owned codec", () => {
  const chords: Chord[] = [
    {},
    { physicalKey: "" },
    { physicalKey: "weird]physicalKey@" },
    { physicalKey: "\ud800" },
    { key: "Any" },
    { key: "-" },
    { key: [] },
    { key: "Enter" },
    { key: "Enter", shift: false },
    { physicalKey: "NumpadEnter", mod: false },
    { key: ["a", "A"], mod: true },
    { key: printableExcept([{ key: ["x", "y"] }], {}), meta: false, ctrl: true },
    { key: " ", physicalKey: "Space", alt: false },
  ];
  for (const chord of chords) {
    const decoded = chordFromText(chordToText(chord));
    expect(decoded).toEqual(chordData(chord));
    expect(JSON.parse(JSON.stringify(decoded))).toStrictEqual(decoded);
    if (decoded === null) throw new Error("missing decoded chord");
    for (const key of ["Enter", "a", "A", "x", " "])
      for (const shiftKey of [true, false])
        expect(matchesChord({ key, physicalKey: "NumpadEnter", shiftKey }, decoded)).toBe(
          matchesChord({ key, physicalKey: "NumpadEnter", shiftKey }, chord),
        );
  }
});

test("ordinary text stays compact and malformed structured constraints refuse", () => {
  const chord = parseChord("Mod-Shift-D");
  if (chord === null) throw new Error("missing compact chord");
  expect(chordToText(chord)).toBe("Mod-Shift-NoAlt-D");
  expect(chordFromText(chordToText(chord))).toEqual(chordData(chord));
  expect(chordFromText("Mod-K")).toEqual(chordData({ key: ["k", "K"], mod: true }));
  expect(chordFromText("Shift-Enter")).toEqual(chordData({ key: "Enter", shift: true }));
  expect(chordFromText("NoShift-Enter")).toEqual(chordData({ key: "Enter", shift: false }));
  expect(chordToText({ key: ["k", "K"], mod: true })).toBe("Mod-K");
  expect(chordToText({ key: "Enter", shift: true })).toBe("Shift-Enter");
  expect(chordFromText('[ "Backspace", "Delete" ]')).toEqual(
    chordData({ key: ["Backspace", "Delete"] }),
  );
  for (const text of ['{"mod":"yes"}', '{"unknown":true}', '{"key":', "Mod-Mod-D", ""])
    expect(chordFromText(text)).toBeNull();
});
