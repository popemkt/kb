/**
 * The canvas's keys in the page kernel, as canvas-ui contributes them, for
 * a test that presses a canvas key or reads a hint without the whole
 * canvas plugin: a plugin of the canvas's name, so the contexts' ids and
 * owner are the kernel's, as the page's.
 */
import { canvasExtension } from "@kb/canvas";
import { definePlugin } from "@kb/plugin";
import { contributeKeyboard } from "@kb/contracts";

export const canvasKeysPlugin = definePlugin({
  name: canvasExtension.name,
  apply: (ctx) => contributeKeyboard(ctx, canvasExtension.keyboard ?? {}),
});
