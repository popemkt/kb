import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import {
  BLACK_HOLE_BACKDROP,
  FLOATING_GEOMETRY_BACKDROP,
  GRADIENT_BACKDROP,
  GRADIENT_ORBS_BACKDROP,
  LENS_BACKDROP,
  ROOST_BACKDROP,
  SILK_BACKDROP,
  SKY_BACKDROP,
  TOON_SEA_BACKDROP,
  UNICORN_BACKDROP,
  WOLF_MEDALLION_BACKDROP,
  backdropsExtension,
  backdropsPlugin,
} from "@kb/backdrops";
import { definePlugin } from "@kb/plugin";
import { BACKDROP_DIRECTIONS } from "@kb/model";
import { BackdropPoint, provideBackdrop, type Backdrop } from "@kb/ui-sdk";
import {
  BlackHoleBackdrop,
  FloatingGeometryBackdrop,
  GradientOrbsBackdrop,
  LensBackdrop,
  SilkBackdrop,
  ToonSeaBackdrop,
  WolfMedallionBackdrop,
} from "./gpu/backdrops";
import { RoostBackdrop } from "./roost/roost-backdrop";
import { SkyBackdrop } from "./sky/sky-backdrop";
import { GradientBackdrop } from "./tint-backdrop";
import { UnicornWashBackdrop } from "./unicorn-backdrop";
import "./backdrops.css";

/** The compact wash alone: no breathing room, and no direction. */
const gradient: Omit<Backdrop, "key"> = {
  presentation: {
    space: 0,
    directions: [],
    height: 160,
    span: { reach: "content", maxWidth: 1120 },
    offset: -40,
    opacity: { subtle: 0.5, soft: 0.75, vivid: 1 },
  },
  Component: GradientBackdrop,
};

/** The Unicorn Studio scene over the wash, in a taller frame that keeps its stars. */
const unicorn: Omit<Backdrop, "key"> = {
  presentation: {
    space: 160,
    directions: BACKDROP_DIRECTIONS,
    height: 500,
    span: { reach: "content", maxWidth: 960 },
    offset: -8,
    opacity: { subtle: 0.35, soft: 0.5, vivid: 0.75 },
  },
  Component: UnicornWashBackdrop,
};

/** The open sky: a canvas scene that feathers into the page on every side. */
const sky: Omit<Backdrop, "key"> = {
  presentation: {
    space: 120,
    directions: BACKDROP_DIRECTIONS,
    height: 360,
    span: { reach: "content", maxWidth: 1040 },
    offset: -10,
    opacity: { subtle: 0.45, soft: 0.68, vivid: 0.88 },
  },
  Component: SkyBackdrop,
};

/** The house with its bats: a taller frame, so the eave has the wall and the sky below it. */
const roost: Omit<Backdrop, "key"> = {
  presentation: {
    space: 140,
    directions: BACKDROP_DIRECTIONS,
    height: 380,
    span: { reach: "content", maxWidth: 1040 },
    offset: -10,
    opacity: { subtle: 0.5, soft: 0.7, vivid: 0.9 },
  },
  Component: RoostBackdrop,
};

/**
 * The GPU scenes' frame: as tall as the sky's, and opaque on the page's own
 * ground, feathered by the stage into it (`gpu/gpu-scene.ts`). They have no
 * direction. Their presence starts higher than a canvas scene's: the scene's
 * own ground is the page, so a lower presence only greys its light.
 */
const gpuFrame: Omit<Backdrop, "key" | "Component">["presentation"] = {
  space: 120,
  directions: [],
  height: 360,
  span: { reach: "content", maxWidth: 1040 },
  offset: -10,
  opacity: { subtle: 0.7, soft: 0.85, vivid: 1 },
};

/** A dark star drifting through a nebula, bending its light. */
const lens: Omit<Backdrop, "key"> = { presentation: gpuFrame, Component: LensBackdrop };

/** Gargantua, its gas disk streaming round it. */
const blackHole: Omit<Backdrop, "key"> = { presentation: gpuFrame, Component: BlackHoleBackdrop };

/**
 * A whole painted scene's frame: a strength barely veils it, since a veil
 * over a high-key picture is a wash that takes its colour (the scene keeps
 * its own quiet: its scrim under the text, its framing by width).
 */
const sceneFrame: Omit<Backdrop, "key" | "Component">["presentation"] = {
  ...gpuFrame,
  opacity: { subtle: 0.95, soft: 0.98, vivid: 1 },
};

/** A cel-shaded sea under anime-game clouds. */
const toonSea: Omit<Backdrop, "key"> = { presentation: sceneFrame, Component: ToonSeaBackdrop };

/** Silk ribbons in three depths on a stage before a faint cosmos. */
const silk: Omit<Backdrop, "key"> = { presentation: sceneFrame, Component: SilkBackdrop };

/**
 * A web of glass facets on deep navy, gold light where they meet. Its field
 * spans the scroll region: a wider window adds field at the sides, and the
 * glass, placed from the content, keeps its place and size.
 */
const floatingGeometry: Omit<Backdrop, "key"> = {
  presentation: { ...gpuFrame, span: { reach: "region" } },
  Component: FloatingGeometryBackdrop,
};

/**
 * Two great orbs in front of a deep blue field: a painted scene, its own
 * field and all, spanning the scroll region so the field reaches the
 * window's sides, the orbs placed from the content.
 */
const gradientOrbs: Omit<Backdrop, "key"> = {
  presentation: { ...sceneFrame, span: { reach: "region" } },
  Component: GradientOrbsBackdrop,
};

/**
 * kb's steel wolf medallion over smoke and embers, sensing the page: the
 * smoke spans the scroll region, the medallion placed from the content.
 */
const wolfMedallion: Omit<Backdrop, "key"> = {
  presentation: { ...gpuFrame, span: { reach: "region" } },
  Component: WolfMedallionBackdrop,
};

/**
 * The backdrops family's page entry: kb's page-head backdrops, contributed
 * to `BackdropPoint` (the unicorn first, the one a head shows while no
 * choice is made), with the family's shared plugin as a child.
 */
export const backdropsUiPlugin = definePlugin({
  name: backdropsExtension.name,
  tags: familyTags(backdropsExtension, "ui"),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(backdropsPlugin()),
        ctx.contribute(BackdropPoint, provideBackdrop(UNICORN_BACKDROP, unicorn)),
        ctx.contribute(BackdropPoint, provideBackdrop(GRADIENT_BACKDROP, gradient)),
        ctx.contribute(BackdropPoint, provideBackdrop(SKY_BACKDROP, sky)),
        ctx.contribute(BackdropPoint, provideBackdrop(ROOST_BACKDROP, roost)),
        ctx.contribute(BackdropPoint, provideBackdrop(LENS_BACKDROP, lens)),
        ctx.contribute(BackdropPoint, provideBackdrop(BLACK_HOLE_BACKDROP, blackHole)),
        ctx.contribute(BackdropPoint, provideBackdrop(TOON_SEA_BACKDROP, toonSea)),
        ctx.contribute(BackdropPoint, provideBackdrop(SILK_BACKDROP, silk)),
        ctx.contribute(
          BackdropPoint,
          provideBackdrop(FLOATING_GEOMETRY_BACKDROP, floatingGeometry),
        ),
        ctx.contribute(BackdropPoint, provideBackdrop(GRADIENT_ORBS_BACKDROP, gradientOrbs)),
        ctx.contribute(BackdropPoint, provideBackdrop(WOLF_MEDALLION_BACKDROP, wolfMedallion)),
      ],
      { discard: true },
    ),
});
