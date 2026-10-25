import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import {
  BROADCAST_BACKDROP,
  CLOUDBANK_BACKDROP,
  PAPER_DESIGN_SYSTEM,
  TERMINAL_DESIGN_SYSTEM,
  TRANSISTOR_DESIGN_SYSTEM,
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
import "@fontsource-variable/archivo/standard.css";
import "@fontsource-variable/archivo/standard-italic.css";
import "@fontsource-variable/jost/wght.css";
import "@fontsource-variable/josefin-sans/wght.css";
import "@fontsource/federant/400.css";
import "./art/art.css";
import { BroadcastBackdrop, CloudbankBackdrop, TransistorArt, ZzzArt } from "./art/entries";
import paper from "./design-systems/paper.css?raw";
import terminal from "./design-systems/terminal.css?raw";
import transistor from "./design-systems/transistor.css?raw";
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

/**
 * The themes family's page entry: Paper and Terminal, each a sheet over
 * layer 1, and ZZZ and Transistor, each a sheet with its faces, its art
 * and the page-head backdrop it pairs with, all contributed under the keys
 * the family declares, with the family's shared plugin as a child.
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
          provideDesignSystem(ZZZ_DESIGN_SYSTEM, {
            stylesheet: zzz,
            Art: ZzzArt,
            backdrop: BROADCAST_BACKDROP.id,
          }),
        ),
        // GAP [[01M5S0J1FVEGHTYJVY4HRS857S]] the palette draws every command the same way,
        // so Transistor cannot draw its functions as cards
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(TRANSISTOR_DESIGN_SYSTEM, {
            stylesheet: transistor,
            Art: TransistorArt,
            backdrop: CLOUDBANK_BACKDROP.id,
          }),
        ),
        ctx.contribute(BackdropPoint, provideBackdrop(BROADCAST_BACKDROP, broadcast)),
        ctx.contribute(BackdropPoint, provideBackdrop(CLOUDBANK_BACKDROP, cloudbank)),
      ],
      { discard: true },
    ),
});
