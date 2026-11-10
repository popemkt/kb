/**
 * The day page's view key (DESIGN-UI.md → Days): `#day`'s default view, so
 * a day node opens in it at `/node/<id>`. The day is the node the view is
 * shown for, so nothing is stored on a view node.
 */
import { Schema } from "effect";
import { viewKey } from "@kb/views";

export const DayParams = Schema.Struct({
  /** The day node the view is shown for. */
  id: Schema.optional(Schema.String),
});
export type DayParams = typeof DayParams.Type;

export const DayView = viewKey(
  "days.day",
  "Day",
  DayParams.annotate({
    description: "A day node: its own outline, then what was made or edited that day.",
  }),
  { read: (_props, host) => (host === null ? {} : { id: host }), write: () => ({}) },
);
