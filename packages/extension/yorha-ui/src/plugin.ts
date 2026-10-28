import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { band } from "@kb/theme-art";
import { BackdropPoint, DesignSystemPoint, provideBackdrop, provideDesignSystem } from "@kb/ui-sdk";
import {
  ARENA_BACKDROP,
  BUNKER_BACKDROP,
  YORHA_DESIGN_SYSTEM,
  yorhaExtension,
  yorhaPlugin,
} from "@kb/yorha";
// YoRHa's faces, under the SIL Open Font License, bundled from npm (never
// committed): each face downloads only when the system sets it.
// GAP [[01M5SNSQH2HMD784PCD51W46D5]] faces are imported here, not declared
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "./art/art.css";
import { ArenaBackdrop, BunkerBackdrop, YorhaArt } from "./art/entries";
// GAP [[01M5SNSPSGYCF6AKWVXQS2GJQJ]] a theme's token values are CSS here, not data
import yorha from "./yorha.css?raw";

/**
 * The YoRHa family's page entry: the theme's sheet with its faces and its
 * art, and the two page heads it brings (which one it pairs with is data
 * its declaration seeds), contributed under the keys the family declares,
 * with the family's shared plugin as a child.
 */
export const yorhaUiPlugin = definePlugin({
  name: yorhaExtension.name,
  tags: familyTags(yorhaExtension, "ui"),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(yorhaPlugin()),
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(YORHA_DESIGN_SYSTEM, { stylesheet: yorha, Art: YorhaArt }),
        ),
        ctx.contribute(BackdropPoint, provideBackdrop(BUNKER_BACKDROP, band(BunkerBackdrop))),
        ctx.contribute(BackdropPoint, provideBackdrop(ARENA_BACKDROP, band(ArenaBackdrop))),
      ],
      { discard: true },
    ),
});
