/**
 * The chart family's seed: the one field a chart view node keeps its spec in,
 * declared the way core declares its own fields; the chart view draws and
 * writes it, so it is `hidden` from field rows. The bundled seed folds it
 * after core's nodes (DESIGN.md → Extension families → the seed is the
 * bundled fold).
 */
import { seededField, type KbNode } from "@kb/model";
import { CHART_IDS } from "./ids.ts";

export function chartSeedNodes(at: string): readonly KbNode[] {
  return [seededField(CHART_IDS.chartField, "chart", "text", at, { one: true, hidden: true })];
}
