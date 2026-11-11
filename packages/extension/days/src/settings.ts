/**
 * The days family's settings a page reads (DESIGN.md → Days), each from
 * the family's node, which they configure.
 */
import { refValuesOf, type NodeLike } from "@kb/model";
import { DAYS_IDS } from "./ids.ts";

/**
 * Whether a day's, week's or year's page lists what was made or edited in
 * it: the `made or edited` setting, hidden unless it says shown.
 */
export function showsTouched(family: Pick<NodeLike, "props"> | undefined): boolean {
  const [choice] = refValuesOf(family, DAYS_IDS.touchedField);
  return choice === DAYS_IDS.touchedShown;
}
