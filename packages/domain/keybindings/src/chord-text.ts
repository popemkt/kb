/** Readable, lossless text for the declarative chord model. */
import { Option, Record as Records, Schema } from "effect";
import { CHORD_MODIFIERS, ChordDataSchema, chordData, type ChordData } from "./chord-data.ts";
import type { Chord } from "./chord.ts";

const readData = Schema.decodeUnknownOption(ChordDataSchema, { onExcessProperty: "error" });
const readStructured = Schema.decodeUnknownOption(Schema.fromJsonString(ChordDataSchema), {
  onExcessProperty: "error",
});

/** Missing modifiers stay unconstrained; NoShift names an explicit false constraint. */
function readModifiers(text: string) {
  const data: Record<string, unknown> = {};
  let rest = text;
  for (;;) {
    const found = Records.toEntries(CHORD_MODIFIERS).find(
      ([, name]) => rest.startsWith(`${name}-`) || rest.startsWith(`No${name}-`),
    );
    if (found === undefined) return { data, rest };
    const [field, name] = found;
    if (field in data) return null;
    const negative = rest.startsWith(`No${name}-`);
    data[field] = !negative;
    rest = rest.slice(name.length + (negative ? 3 : 1));
  }
}

function readKey(text: string) {
  if (text === "Any") return {};
  if (text === "Printable") return { key: { kind: "printable", except: [] } };
  if (text.startsWith("Printable except "))
    return {
      key: { kind: "printable", except: JSON.parse(text.slice("Printable except ".length)) },
    };
  if (text.startsWith('"') || text.startsWith("[")) return { key: JSON.parse(text) };
  if (text === "" || (text.includes("-") && text !== "-")) throw new Error("Invalid key text");
  const lower = text.toLowerCase();
  const upper = text.toUpperCase();
  return { key: text.length === 1 && lower !== upper ? [lower, upper] : text };
}

function readPosition(text: string) {
  if (text.startsWith("Code[")) {
    const match = /^Code\[("(?:[^"\\]|\\.)*")\](?:@(.*))?$/.exec(text);
    if (match === null || match[1] === undefined) throw new Error("Invalid physical key text");
    return {
      physicalKey: JSON.parse(match[1]),
      ...(match[2] === undefined ? {} : readKey(match[2])),
    };
  }
  const end = text.indexOf("]", 1);
  if (end < 0) throw new Error("Unclosed physical key");
  const position = text.slice(1, end);
  const rest = text.slice(end + 1);
  if (rest !== "" && !rest.startsWith("@")) throw new Error("Invalid physical key text");
  return { physicalKey: position, ...(rest === "" ? {} : readKey(rest.slice(1))) };
}

/** Basic chords read Mod-K; exact-up states, positions and matchers remain explicit data. */
export function chordFromText(text: string): ChordData | null {
  const value = text.trim();
  // Earlier imported structured values remain readable; canonical output uses the notation below.
  if (value.startsWith("{")) {
    const decoded = readStructured(value);
    return Option.isSome(decoded) ? chordData(decoded.value) : null;
  }
  const modifiers = readModifiers(value);
  if (modifiers === null) return null;
  const key = modifiers.rest;
  try {
    const position = key.startsWith("Code[") || /^\[[A-Za-z0-9]+\](?:@|$)/.test(key);
    const decoded = readData({
      ...modifiers.data,
      ...(position ? readPosition(key) : readKey(key)),
    });
    return Option.isSome(decoded) ? chordData(decoded.value) : null;
  } catch {
    return null;
  }
}

function keyText(key: ChordData["key"]): string {
  if (key === undefined) return "Any";
  if (typeof key === "object" && "kind" in key)
    return key.except.length === 0 ? "Printable" : `Printable except ${JSON.stringify(key.except)}`;
  const keys = typeof key === "string" ? [key] : key;
  const first = keys[0];
  if (keys.length === 2 && first?.length === 1) {
    const lower = first.toLowerCase();
    const upper = first.toUpperCase();
    if (lower !== upper && keys.includes(lower) && keys.includes(upper)) return upper;
  }
  if (keys.length !== 1 || first === undefined) return JSON.stringify(keys);
  const letter = first.length === 1 && first.toLowerCase() !== first.toUpperCase();
  return !letter && /^[A-Za-z0-9]+$|^-$/.test(first) && !["Any", "Printable"].includes(first)
    ? first
    : JSON.stringify(first);
}

/** Formatting never inserts a false modifier or broadens a character set to make text shorter. */
export function chordToText(chord: Chord): string {
  const data = chordData(chord);
  const modifiers = Records.toEntries(CHORD_MODIFIERS).flatMap(([field, name]) =>
    data[field] === undefined ? [] : [data[field] ? name : `No${name}`],
  );
  const position = data.physicalKey;
  const key =
    position === undefined
      ? keyText(data.key)
      : `${/^[A-Za-z0-9]+$/.test(position) ? `[${position}]` : `Code[${JSON.stringify(position)}]`}${data.key === undefined ? "" : `@${keyText(data.key)}`}`;
  return [...modifiers, key].join("-");
}
