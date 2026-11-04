/**
 * The one RRULE engine the family reads: what projects a routine's series and
 * what expands it for the calendar both take `RRule` from here.
 */
import { Schema } from "effect";
import * as recurrenceModule from "rrule";

// The library publishes ESM to bundlers and CommonJS to Node. Both resolve to one constructor.
const RecurrenceExports = Schema.Struct({
  RRule: Schema.declare<typeof recurrenceModule.RRule>(
    (value): value is typeof recurrenceModule.RRule =>
      typeof value === "function" &&
      "fromString" in value &&
      typeof value.fromString === "function",
  ),
});
const loadedRecurrence = Schema.decodeSync(
  Schema.Union([RecurrenceExports, Schema.Struct({ default: RecurrenceExports })]),
)(recurrenceModule);
export const { RRule } =
  "default" in loadedRecurrence ? loadedRecurrence.default : loadedRecurrence;
