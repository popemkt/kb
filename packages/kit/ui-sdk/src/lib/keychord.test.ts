import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  chordsOverlap,
  describeChord,
  lookupChord,
  matchesChord,
  parseChord,
  type Chord,
  type KeyChordEvent,
} from "./keychord.ts";

describe("parseChord", () => {
  it.each([
    ["Alt-ArrowUp", { key: "ArrowUp", meta: false, ctrl: false, shift: false, alt: true }],
    ["Mod-Shift-k", { key: ["k", "K"], mod: true, shift: true, alt: false }],
    ["Mod-K", { key: ["k", "K"], mod: true, shift: false, alt: false }],
    ["Ctrl--", { key: "-", meta: false, ctrl: true, shift: false, alt: false }],
    ["Enter", { key: "Enter", meta: false, ctrl: false, shift: false, alt: false }],
  ])("reads %s as an exact chord", (text, chord) => {
    expect(parseChord(text)).toEqual(chord);
  });

  it.each(["", "Alt-", "Hyper-x", "Shift-Shift-x", "Mod-Ctrl-x"])("refuses %j", (text) => {
    expect(parseChord(text)).toBeNull();
  });

  it("matches a letter in either case, Shift being its flag", () => {
    const chord = parseChord("Mod-Shift-s") as Chord;
    expect(matchesChord({ key: "s", metaKey: true, shiftKey: true }, chord)).toBe(true);
    expect(matchesChord({ key: "S", ctrlKey: true, shiftKey: true }, chord)).toBe(true);
    expect(matchesChord({ key: "S", ctrlKey: true }, chord)).toBe(false);
    expect(describeChord(chord)).toBe("Mod-Shift-s");
  });

  it("matches only the modifiers it names", () => {
    const chord = parseChord("Alt-ArrowUp") as Chord;
    expect(matchesChord({ key: "ArrowUp", altKey: true }, chord)).toBe(true);
    expect(matchesChord({ key: "ArrowUp", altKey: true, shiftKey: true }, chord)).toBe(false);
    expect(matchesChord({ key: "ArrowUp" }, chord)).toBe(false);
  });
});

const KEYS = ["a", "A", "Enter", "ArrowUp", "Escape", " "] as const;
const flag = fc.option(fc.boolean(), { nil: undefined });
const chordArb: fc.Arbitrary<Chord> = fc.record({
  key: fc.option(fc.subarray([...KEYS], { minLength: 1 }), { nil: undefined }),
  mod: flag,
  meta: flag,
  ctrl: flag,
  shift: flag,
  alt: flag,
});
const events: readonly KeyChordEvent[] = KEYS.flatMap((key) =>
  Array.from({ length: 16 }, (_, bits) => ({
    key,
    metaKey: (bits & 1) !== 0,
    ctrlKey: (bits & 2) !== 0,
    shiftKey: (bits & 4) !== 0,
    altKey: (bits & 8) !== 0,
  })),
);

describe("chordsOverlap", () => {
  it("is exactly whether some key event matches both", () => {
    fc.assert(
      fc.property(chordArb, chordArb, (a, b) => {
        const both = events.some((ev) => matchesChord(ev, a) && matchesChord(ev, b));
        expect(chordsOverlap(a, b)).toBe(both);
      }),
    );
  });
});

describe("a chord by place", () => {
  const numpad7: Chord = { code: "Numpad7", mod: false };
  const seven: Chord = { key: "7", mod: false };

  it("matches the key at its place, whatever character it types", () => {
    expect(matchesChord({ key: "7", code: "Numpad7" }, numpad7)).toBe(true);
    expect(matchesChord({ key: "Home", code: "Numpad7" }, numpad7)).toBe(true);
    expect(matchesChord({ key: "7", code: "Digit7" }, numpad7)).toBe(false);
    expect(matchesChord({ key: "7" }, numpad7)).toBe(false);
  });

  it("never overlaps a chord by character, and overlaps one by place only at that place", () => {
    expect(chordsOverlap(numpad7, seven)).toBe(false);
    expect(chordsOverlap(numpad7, { code: "Numpad7" })).toBe(true);
    expect(chordsOverlap(numpad7, { code: "Numpad1", mod: false })).toBe(false);
    expect(chordsOverlap(numpad7, { code: "Numpad7", mod: true })).toBe(false);
  });

  it("is asked before a chord by character, wherever it is listed", () => {
    const rows = [
      { chord: seven, name: "frame tool" },
      { chord: numpad7, name: "look from the top" },
    ];
    expect(lookupChord({ key: "7", code: "Numpad7" }, rows)?.name).toBe("look from the top");
    expect(lookupChord({ key: "7", code: "Digit7" }, rows)?.name).toBe("frame tool");
  });

  it("reads as its place", () => {
    expect(describeChord({ code: "KeyH", alt: true, shift: true })).toBe("Shift-Alt-[KeyH]");
  });
});
