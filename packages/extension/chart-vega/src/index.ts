/**
 * The chart family's painter and server entry. Vega is the painter
 * (`vega.ts`), and both hosts load it the first time they draw: the
 * browser's chart chunk, and the server when a chart page's figure is
 * painted. The server entry stays one plugin, built without Vega, so a
 * command that draws no chart parses none of it (DESIGN.md → Extension
 * families → a painter belongs to the view that paints with it).
 */
import { Effect } from "effect";
import { chartPlugin, type ChartPainter } from "@kb/chart";
import type { Plugin } from "@kb/plugin";

/** Vega, as kb runs it: loaded on first use, by whichever host draws first. */
export const loadVega = () => import("./vega.ts");

/** The chart's painter where no browser draws: Vega, headless, loaded with the first figure. */
export const vegaChartPainter: ChartPainter = {
  svg: (spec) => Effect.flatMap(Effect.promise(loadVega), ({ chartSvg }) => chartSvg(spec)),
};

/** The chart family's server entry: its shared plugin, painting each chart page's figure with Vega. */
export const chartServerPlugin: Plugin = chartPlugin({ painter: vegaChartPainter });
