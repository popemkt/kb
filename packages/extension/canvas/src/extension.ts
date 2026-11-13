import { CANVAS_COLOR_TOKENS } from "./paint-css.ts";
/**
 * The canvas family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The declaration is the one home of the family's
 * name, seed, views, the references its documents carry and the context
 * references it resolves on a pane; the bundled
 * fold reads it, and both hosts' entries
 * load {@link canvasPlugin}, so the keys and the seed cannot differ between
 * them. The server's entry (`@kb/ext-canvas`) adds the family's actions, and
 * the page's adds its surfaces. A canvas says itself in the generic text, so
 * its views carry no text of their own. A `#canvas` node opens in its
 * canvas (`tagDefaultViews`), and its canvas view draws a preview of it
 * (`CanvasView.preview`). It is optional and on by default.
 */
import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { canvasRunFieldGuard } from "./run-field-guard.ts";
import {
  declarationPlugin,
  defineExtension,
  viewDef,
  guardAction,
  familyTags,
} from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { CANVAS_CONTEXT } from "./context.ts";
import { CANVAS_IDS } from "./ids.ts";
import { canvasReferences } from "./references.ts";
import { canvasSeedNodes } from "./seed.ts";
import { CanvasListView, CanvasView } from "./view.ts";

export const canvasExtension = defineExtension({
  name: "canvas",
  colorTokens: CANVAS_COLOR_TOKENS,
  label: "Canvas",
  manifest: { description: "Free-form canvases of cards, links and frames." },
  tags: ["canvas"],
  optional: { byDefault: "on" },
  seed: canvasSeedNodes,
  views: [viewDef(CanvasListView), viewDef(CanvasView)],
  tagDefaultViews: { [CANVAS_IDS.canvasTag]: CanvasView },
  refCarriers: [{ field: CANVAS_IDS.canvasField, refsOf: canvasReferences }],
  context: CANVAS_CONTEXT,
});

/**
 * The canvas family's shared plugin: its declaration's views. Each host's
 * entry loads it as a child.
 */
export function canvasPlugin(): Plugin {
  return definePlugin({
    name: canvasExtension.name,
    tags: familyTags(canvasExtension),
    apply: (ctx) =>
      Effect.all(
        [
          ctx.plugin(declarationPlugin(canvasExtension)),
          guardAction(ctx, "every write", canvasRunFieldGuard, "run-fields"),
        ],
        { discard: true },
      ),
  });
}
