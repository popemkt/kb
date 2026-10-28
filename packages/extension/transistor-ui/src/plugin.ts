import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { band } from "@kb/theme-art";
import {
  CLOUDBANK_BACKDROP,
  OVC_BACKDROP,
  TRANSISTOR_DESIGN_SYSTEM,
  transistorExtension,
  transistorPlugin,
} from "@kb/transistor";
import {
  BackdropPoint,
  DesignSystemPoint,
  provideBackdrop,
  provideDesignSystem,
  type Backdrop,
} from "@kb/ui-sdk";
// Transistor's faces, all under the SIL Open Font License, bundled from npm
// (never committed): each face downloads only when the system sets it.
// GAP [[01M5SNSQH2HMD784PCD51W46D5]] faces are imported here, not declared
import "@fontsource-variable/jost/wght.css";
import "@fontsource-variable/josefin-sans/wght.css";
import "@fontsource/marcellus-sc/400.css";
import "@fontsource/share-tech-mono/400.css";
import "./art/art.css";
import { CloudbankBackdrop, OvcBackdrop, TransistorArt } from "./art/entries";
// GAP [[01M5SNSPSGYCF6AKWVXQS2GJQJ]] a theme's token values are CSS here, not data
import transistor from "./transistor.css?raw";

/** Transistor's head: a painted dusk whose skyline the title stands under. */
const cloudbank: Omit<Backdrop, "key"> = {
  presentation: {
    space: 160,
    directions: [],
    height: 250,
    maxWidth: 1120,
    offset: -24,
    opacity: { subtle: 0.7, soft: 0.85, vivid: 1 },
  },
  Component: CloudbankBackdrop,
};

/**
 * The Transistor family's page entry: the theme's sheet with its faces and
 * its art, and the two page heads it brings (which one it pairs with is
 * data its declaration seeds), contributed under the keys the family
 * declares, with the family's shared plugin as a child.
 */
export const transistorUiPlugin = definePlugin({
  name: transistorExtension.name,
  tags: familyTags(transistorExtension, "ui"),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(transistorPlugin()),
        // GAP [[01M5S0J1FVEGHTYJVY4HRS857S]] the palette draws every command the same way,
        // so Transistor cannot draw its functions as cards
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(TRANSISTOR_DESIGN_SYSTEM, {
            stylesheet: transistor,
            Art: TransistorArt,
          }),
        ),
        ctx.contribute(BackdropPoint, provideBackdrop(CLOUDBANK_BACKDROP, cloudbank)),
        ctx.contribute(BackdropPoint, provideBackdrop(OVC_BACKDROP, band(OvcBackdrop))),
      ],
      { discard: true },
    ),
});
