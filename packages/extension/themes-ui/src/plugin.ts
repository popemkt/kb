import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import {
  PAPER_DESIGN_SYSTEM,
  TERMINAL_DESIGN_SYSTEM,
  themesExtension,
  themesPlugin,
} from "@kb/themes";
import { DesignSystemPoint, provideDesignSystem } from "@kb/ui-sdk";
// GAP [[01M5SNSPSGYCF6AKWVXQS2GJQJ]] a theme's token values are CSS here, not data
import paper from "./design-systems/paper.css?raw";
import terminal from "./design-systems/terminal.css?raw";

/**
 * The themes family's page entry: Paper and Terminal, each a sheet over
 * layer 1 with no art, contributed under the keys the family declares,
 * with the family's shared plugin as a child.
 */
export const themesUiPlugin = definePlugin({
  name: themesExtension.name,
  tags: familyTags(themesExtension, "ui"),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(themesPlugin()),
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(PAPER_DESIGN_SYSTEM, { stylesheet: paper }),
        ),
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(TERMINAL_DESIGN_SYSTEM, { stylesheet: terminal }),
        ),
      ],
      { discard: true },
    ),
});
