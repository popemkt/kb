import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import {
  BROADCAST_BACKDROP,
  BUNKER_BACKDROP,
  CLOUDBANK_BACKDROP,
  HOLLOW_BACKDROP,
  OVC_BACKDROP,
  PAPER_DESIGN_SYSTEM,
  TERMINAL_DESIGN_SYSTEM,
  TRANSISTOR_DESIGN_SYSTEM,
  YORHA_DESIGN_SYSTEM,
  ZZZ_DESIGN_SYSTEM,
  themesExtension,
  themesPlugin,
} from "@kb/themes";
import {
  BackdropPoint,
  DesignSystemPoint,
  provideBackdrop,
  provideDesignSystem,
  type Backdrop,
} from "@kb/ui-sdk";
// The themes' faces, all under the SIL Open Font License, bundled from
// npm (never committed): each face downloads only when a system sets it.
// GAP [[01M5SNSQH2HMD784PCD51W46D5]] faces are imported here, not declared
import "@fontsource-variable/archivo/standard.css";
import "@fontsource-variable/archivo/standard-italic.css";
import "@fontsource-variable/jost/wght.css";
import "@fontsource-variable/josefin-sans/wght.css";
import "@fontsource/marcellus-sc/400.css";
import "@fontsource/share-tech-mono/400.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "./art/art.css";
import "./art/yorha.css";
import "./art/backdrops-extra.css";
import {
  BroadcastBackdrop,
  BunkerBackdrop,
  CloudbankBackdrop,
  HollowBackdrop,
  OvcBackdrop,
  TransistorArt,
  YorhaArt,
  ZzzArt,
} from "./art/entries";
// GAP [[01M5SNSPSGYCF6AKWVXQS2GJQJ]] a theme's token values are CSS here, not data
import paper from "./design-systems/paper.css?raw";
import terminal from "./design-systems/terminal.css?raw";
import transistor from "./design-systems/transistor.css?raw";
import yorha from "./design-systems/yorha.css?raw";
import zzz from "./design-systems/zzz.css?raw";

/** ZZZ's head: the panel stack and its TV, wholly above the title. */
const broadcast: Omit<Backdrop, "key"> = {
  presentation: {
    space: 160,
    directions: [],
    height: 168,
    maxWidth: 1040,
    offset: -6,
    opacity: { subtle: 0.72, soft: 0.86, vivid: 1 },
  },
  Component: BroadcastBackdrop,
};

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

/** A theme's other heads: a band across the top, as tall as Broadcast's. */
const band = (Component: Backdrop["Component"]): Omit<Backdrop, "key"> => ({
  presentation: {
    space: 160,
    directions: [],
    height: 180,
    maxWidth: 1080,
    offset: -10,
    opacity: { subtle: 0.72, soft: 0.86, vivid: 1 },
  },
  Component,
});

/**
 * The themes family's page entry: Paper and Terminal, each a sheet over
 * layer 1, and ZZZ, Transistor and YoRHa, each a sheet with its faces and
 * its art, and the page-head backdrops each theme brings (which theme a
 * backdrop belongs to, and which one a theme pairs with, are data its
 * declaration seeds), all contributed under the keys the family declares,
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
        // GAP [[01M5S0HPNDEZ9RSQW4W679VP03]] a theme cannot bring a graph look of its own
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(ZZZ_DESIGN_SYSTEM, { stylesheet: zzz, Art: ZzzArt }),
        ),
        // GAP [[01M5S0J1FVEGHTYJVY4HRS857S]] the palette draws every command the same way,
        // so Transistor cannot draw its functions as cards
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(TRANSISTOR_DESIGN_SYSTEM, {
            stylesheet: transistor,
            Art: TransistorArt,
          }),
        ),
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(YORHA_DESIGN_SYSTEM, { stylesheet: yorha, Art: YorhaArt }),
        ),
        ctx.contribute(BackdropPoint, provideBackdrop(BROADCAST_BACKDROP, broadcast)),
        ctx.contribute(BackdropPoint, provideBackdrop(HOLLOW_BACKDROP, band(HollowBackdrop))),
        ctx.contribute(BackdropPoint, provideBackdrop(CLOUDBANK_BACKDROP, cloudbank)),
        ctx.contribute(BackdropPoint, provideBackdrop(OVC_BACKDROP, band(OvcBackdrop))),
        ctx.contribute(BackdropPoint, provideBackdrop(BUNKER_BACKDROP, band(BunkerBackdrop))),
      ],
      { discard: true },
    ),
});
