/** Lossless declarative chords; executable plugin predicates are not stored data. */
import type { Chord } from "./chord.ts";
import { Schema } from "effect";

const PrintableKeysSchema = Schema.Struct({
  kind: Schema.Literal("printable"),
  except: Schema.Array(Schema.String),
});

export const ChordDataSchema = Schema.Struct({
  /** Absent means any key; the modifier constraints carry the whole chord. */
  key: Schema.optional(
    Schema.Union([Schema.String, Schema.Array(Schema.String), PrintableKeysSchema]),
  ),
  /** Physical key position (`KeyboardEvent.code`), independent of layout. */
  physicalKey: Schema.optional(Schema.String),
  /** Platform command modifier: meta OR control; absent is unconstrained. */
  mod: Schema.optional(Schema.Boolean),
  meta: Schema.optional(Schema.Boolean),
  ctrl: Schema.optional(Schema.Boolean),
  shift: Schema.optional(Schema.Boolean),
  alt: Schema.optional(Schema.Boolean),
});
export type ChordData = typeof ChordDataSchema.Type;

/** The schema's boolean constraints are its modifier fields. */
type ModifierField = keyof {
  [Field in keyof ChordData as NonNullable<ChordData[Field]> extends boolean
    ? Field
    : never]: ChordData[Field];
};

/** Text names belong to the schema members they spell, including explicit negative constraints. */
export const CHORD_MODIFIERS = {
  mod: "Mod",
  meta: "Meta",
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
} as const satisfies Record<ModifierField, string>;

/** Canonical data drops representation-only differences between one character and a one-item set. */
export function chordData(chord: Chord): ChordData {
  const data = Schema.decodeUnknownSync(ChordDataSchema)(chord);
  const key = data.key;
  return {
    ...data,
    ...(key === undefined
      ? {}
      : {
          key:
            typeof key === "string"
              ? [key]
              : "kind" in key
                ? { kind: key.kind, except: [...new Set(key.except)].toSorted() }
                : [...new Set(key)].toSorted(),
        }),
  };
}
