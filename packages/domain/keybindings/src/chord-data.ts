/** Lossless declarative chords; executable plugin predicates are not stored data. */
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
  code: Schema.optional(Schema.String),
  /** Platform command modifier: meta OR control; absent is unconstrained. */
  mod: Schema.optional(Schema.Boolean),
  meta: Schema.optional(Schema.Boolean),
  ctrl: Schema.optional(Schema.Boolean),
  shift: Schema.optional(Schema.Boolean),
  alt: Schema.optional(Schema.Boolean),
});
export type ChordData = typeof ChordDataSchema.Type;
