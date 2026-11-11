/** Lossless declarative chords; executable plugin predicates are not stored data. */
import { Schema } from "effect";

const PrintableKeysSchema = Schema.Struct({
  kind: Schema.Literal("printable"),
  except: Schema.Array(Schema.String),
});

export const ChordDataSchema = Schema.Struct({
  key: Schema.optional(
    Schema.Union([Schema.String, Schema.Array(Schema.String), PrintableKeysSchema]),
  ),
  code: Schema.optional(Schema.String),
  mod: Schema.optional(Schema.Boolean),
  meta: Schema.optional(Schema.Boolean),
  ctrl: Schema.optional(Schema.Boolean),
  shift: Schema.optional(Schema.Boolean),
  alt: Schema.optional(Schema.Boolean),
});
export type ChordData = typeof ChordDataSchema.Type;
