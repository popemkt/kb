import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { band } from "@kb/theme-art";
import {
  BackdropPoint,
  DesignSystemPoint,
  provideBackdrop,
  provideDesignSystem,
  type Backdrop,
} from "@kb/ui-sdk";
import {
  BROADCAST_BACKDROP,
  HOLLOW_BACKDROP,
  ZZZ_DESIGN_SYSTEM,
  zzzExtension,
  zzzPlugin,
} from "@kb/zzz";
// ZZZ's face, under the SIL Open Font License, bundled from npm (never
// committed): it downloads only when the system sets it.
// GAP [[01M5SNSQH2HMD784PCD51W46D5]] faces are imported here, not declared
import "@fontsource-variable/archivo/standard.css";
import "@fontsource-variable/archivo/standard-italic.css";
import "./art/art.css";
import { BroadcastBackdrop, HollowBackdrop, ZzzArt } from "./art/entries";
// GAP [[01M5SNSPSGYCF6AKWVXQS2GJQJ]] a theme's token values are CSS here, not data
import zzz from "./zzz.css?raw";

/** ZZZ's head: the panel stack and its TV, wholly above the title. */
const broadcast: Omit<Backdrop, "key"> = {
  presentation: {
    space: 160,
    directions: [],
    height: 168,
    span: { reach: "content", maxWidth: 1040 },
    offset: -6,
    opacity: { subtle: 0.72, soft: 0.86, vivid: 1 },
  },
  Component: BroadcastBackdrop,
};

/**
 * The ZZZ family's page entry: the theme's sheet with its face and its art,
 * and the two page heads it brings (which one it pairs with is data its
 * declaration seeds), contributed under the keys the family declares, with
 * the family's shared plugin as a child.
 */
export const zzzUiPlugin = definePlugin({
  name: zzzExtension.name,
  tags: familyTags(zzzExtension, "ui"),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(zzzPlugin()),
        // GAP [[01M5S0HPNDEZ9RSQW4W679VP03]] a theme cannot bring a graph look of its own
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(ZZZ_DESIGN_SYSTEM, { stylesheet: zzz, Art: ZzzArt }),
        ),
        ctx.contribute(BackdropPoint, provideBackdrop(BROADCAST_BACKDROP, broadcast)),
        ctx.contribute(BackdropPoint, provideBackdrop(HOLLOW_BACKDROP, band(HollowBackdrop))),
      ],
      { discard: true },
    ),
});
