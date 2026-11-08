import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import {
  ASTRAL_BACKDROP,
  BLACK_HOLE_BACKDROP,
  DISC_FIELD_BACKDROP,
  FLOATING_GEOMETRY_BACKDROP,
  GRADIENT_BACKDROP,
  GRADIENT_ORBS_BACKDROP,
  LIGHT_TRAILS_BACKDROP,
  LENS_BACKDROP,
  ROOST_BACKDROP,
  SILK_BACKDROP,
  SKY_BACKDROP,
  TOON_SEA_BACKDROP,
  UNICORN_BACKDROP,
  WOLF_MEDALLION_BACKDROP,
  BackdropStudioView,
  backdropsExtension,
  backdropsPlugin,
} from "@kb/backdrops";
import { definePlugin } from "@kb/plugin";
import { BACKDROP_DIRECTIONS } from "@kb/model";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";
import {
  BACKDROP_BUDGETS,
  BackdropActionPoint,
  BackdropPoint,
  navigate,
  provideBackdrop,
  provideRoute,
  provideView,
  RoutePoint,
  ViewPoint,
  type Backdrop,
} from "@kb/ui-sdk";
import {
  AstralBackdrop,
  BlackHoleBackdrop,
  DiscFieldBackdrop,
  FloatingGeometryBackdrop,
  GradientOrbsBackdrop,
  LensBackdrop,
  LightTrailsBackdrop,
  SilkBackdrop,
  ToonSeaBackdrop,
  WolfMedallionBackdrop,
} from "./gpu/backdrops";
import { HEAD_HEIGHT } from "./gpu/head";
import { RoostBackdrop } from "./roost/roost-backdrop";
import { SkyBackdrop } from "./sky/sky-backdrop";
import { matchStudio, studioPath } from "./studio/routes";
import { StudioSurface } from "./studio/surfaces";
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
  budget: BACKDROP_BUDGETS.dom,
  interactions: [],
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
  // GAP [[01M6RT9R6AXGVYZWCSTG26EET8]] a vendor runtime's frames are not metered against its budget
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [{ cue: "pointer", does: "the nebula drifts sideways with the cursor" }],
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
  budget: BACKDROP_BUDGETS.canvas,
  interactions: [
    { cue: "pointer", does: "birds scatter from the cursor" },
    { cue: "editing", does: "the flock slows and glides" },
    { cue: "writes", does: "birds fly and flap faster" },
    { cue: "navigation", does: "the flock drifts somewhere new and bunches up" },
  ],
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
  budget: BACKDROP_BUDGETS.canvas,
  interactions: [
    { cue: "pointer", does: "nearby bats shiver and open their eyes" },
    { cue: "editing", does: "bats breathe slower and stay roosting" },
    { cue: "writes", does: "a hanging bat shuffles" },
    { cue: "navigation", does: "a shiver ripples along the row" },
  ],
  Component: RoostBackdrop,
};

/**
 * The GPU scenes' frame: as tall as the sky's, and opaque on the page's own
 * ground, feathered by the stage into it (`gpu/gpu-scene.ts`). They have no
 * direction. Their presence starts higher than a canvas scene's: the scene's
 * own ground is the page, so a lower presence only greys its light.
 */
const gpuFrame: Backdrop["presentation"] = {
  space: 120,
  directions: [],
  height: HEAD_HEIGHT,
  span: { reach: "content", maxWidth: 1040 },
  offset: -10,
  opacity: { subtle: 0.7, soft: 0.85, vivid: 1 },
};

/** A dark star drifting through a nebula, bending its light. */
const lens: Omit<Backdrop, "key"> = {
  presentation: gpuFrame,
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [
    { cue: "pointer", does: "the dark star follows the cursor" },
    { cue: "editing", does: "the star's pull eases" },
    { cue: "writes", does: "the star swells and a supernova flares beside it" },
  ],
  Component: LensBackdrop,
};

/** Gargantua, its gas disk streaming round it. */
const blackHole: Omit<Backdrop, "key"> = {
  presentation: gpuFrame,
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [
    { cue: "pointer", does: "the camera tilts and swings with the cursor" },
    { cue: "editing", does: "the gas disk dims" },
    { cue: "writes", does: "the disk brightens and a hot flare orbits" },
  ],
  Component: BlackHoleBackdrop,
};

/**
 * A whole painted scene's frame: a strength barely veils it, since a veil
 * over a high-key picture is a wash that takes its colour (the scene keeps
 * its own quiet: its scrim under the text, its framing by width).
 */
const sceneFrame: Backdrop["presentation"] = {
  ...gpuFrame,
  opacity: { subtle: 0.95, soft: 0.98, vivid: 1 },
};

/** A cel-shaded sea under anime-game clouds. */
const toonSea: Omit<Backdrop, "key"> = {
  presentation: sceneFrame,
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [
    { cue: "pointer", does: "ripple rings spread from the cursor" },
    { cue: "editing", does: "the swell calms and the sea slows" },
    { cue: "writes", does: "splash rings and glints burst across the sea" },
  ],
  Component: ToonSeaBackdrop,
};

/** Silk ribbons in three depths on a stage before a faint cosmos. */
const silk: Omit<Backdrop, "key"> = {
  presentation: sceneFrame,
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [
    { cue: "pointer", does: "the cursor's wind lifts the ribbons" },
    { cue: "editing", does: "the ribbons slow and the light sweep rests" },
    { cue: "writes", does: "a shimmer runs along the ribbons, and they flutter faster" },
  ],
  Component: SilkBackdrop,
};

/**
 * A web of glass facets on deep navy, gold light where they meet. Its field
 * spans the scroll region: a wider window adds field at the sides, and the
 * glass, placed from the content, keeps its place and size.
 */
const floatingGeometry: Omit<Backdrop, "key"> = {
  presentation: { ...gpuFrame, span: { reach: "region" } },
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [
    { cue: "pointer", does: "the gold lamp follows the cursor and the glass shifts" },
    { cue: "editing", does: "the drift slows and the light sweep rests" },
    { cue: "writes", does: "the lamps glow hotter and the glass folds" },
    { cue: "navigation", does: "the glass folds and eases back" },
  ],
  Component: FloatingGeometryBackdrop,
};

/**
 * Two great orbs in front of a deep blue field: a painted scene, its own
 * field and all, spanning the scroll region so the field reaches the
 * window's sides, the orbs placed from the content.
 */
const gradientOrbs: Omit<Backdrop, "key"> = {
  presentation: { ...sceneFrame, span: { reach: "region" } },
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [
    { cue: "pointer", does: "the orbs turn their lit faces to the cursor" },
    { cue: "editing", does: "the orbs drift more slowly" },
    { cue: "writes", does: "the orbs swell and their glow brightens" },
  ],
  Component: GradientOrbsBackdrop,
};

/**
 * kb's steel wolf medallion over smoke and embers, sensing the page: the
 * smoke spans the scroll region, the medallion placed from the content.
 */
const wolfMedallion: Omit<Backdrop, "key"> = {
  presentation: { ...gpuFrame, span: { reach: "region" } },
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [
    { cue: "pointer", does: "the eyes glow as the cursor nears; moving it scatters embers" },
    { cue: "editing", does: "the smoke slows" },
    { cue: "writes", does: "the glyph circle turns faster" },
    { cue: "arrivals", does: "the eyes flash silver and the medallion swings" },
    { cue: "errors", does: "the eyes flash red and the medallion swings" },
    { cue: "turns", does: "the eyes flash gold and the medallion swings" },
  ],
  Component: WolfMedallionBackdrop,
};

/**
 * Long-exposure light streaking across a deep navy field: its field spans
 * the scroll region, the knot of light placed from the content.
 */
const lightTrails: Omit<Backdrop, "key"> = {
  presentation: { ...sceneFrame, span: { reach: "region" } },
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [
    { cue: "pointer", does: "the trails burn brighter and lean toward the cursor" },
    { cue: "editing", does: "the light runs more slowly" },
    { cue: "writes", does: "light packets along the strands brighten" },
  ],
  Component: LightTrailsBackdrop,
};

/**
 * Celestial instruments in a living sky: the sky spans the scroll region,
 * the instrument placed from the content.
 */
const astral: Omit<Backdrop, "key"> = {
  presentation: { ...sceneFrame, span: { reach: "region" } },
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [
    { cue: "pointer", does: "the light swings toward the cursor and nearby stars glint" },
    { cue: "writes", does: "the gears tick a notch and the hub star flares" },
    { cue: "navigation", does: "the gears tick a notch and the hub star flares" },
    { cue: "arrivals", does: "the gears tick a notch and the hub star flares" },
    { cue: "errors", does: "the gears tick a notch and the hub star flares" },
    { cue: "turns", does: "the gears tick a notch and the hub star flares" },
  ],
  Component: AstralBackdrop,
};

/**
 * A vineyard lane painted in overlapping discs on the page's own ground: it
 * spans the scroll region, the painting placed from the content and
 * dissolving into the page by its own spray, so a wider window adds page.
 */
const discField: Omit<Backdrop, "key"> = {
  presentation: { ...sceneFrame, span: { reach: "region" } },
  budget: BACKDROP_BUDGETS.gpu,
  interactions: [
    { cue: "pointer", does: "the view leans toward the cursor" },
    { cue: "writes", does: "a gust of wind moves through the leaves" },
  ],
  Component: DiscFieldBackdrop,
};

/**
 * The backdrops family's page entry: kb's page-head backdrops, contributed
 * to `BackdropPoint` (the unicorn first, the one a head shows while no
 * choice is made), Backdrop Studio's view and its route (`/backdrops`, the
 * gallery; `/backdrops/<id>`, one backdrop), and "Open in Studio" among a
 * head's backdrop actions (`BackdropActionPoint`), with the family's shared
 * plugin as a child, which brings the studio's key to the page's catalog.
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
        ctx.contribute(BackdropPoint, provideBackdrop(LIGHT_TRAILS_BACKDROP, lightTrails)),
        ctx.contribute(BackdropPoint, provideBackdrop(ASTRAL_BACKDROP, astral)),
        ctx.contribute(BackdropPoint, provideBackdrop(DISC_FIELD_BACKDROP, discField)),
        ctx.contribute(
          ViewPoint,
          provideView(BackdropStudioView, {
            placements: ["page"],
            sample: {},
            Component: StudioSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: BackdropStudioView,
            match: matchStudio,
            entry: "/backdrops",
            frame: () => "full",
            pendingTitle: () => "Opening Backdrop Studio…",
          }),
        ),
        ctx.contribute(BackdropActionPoint, {
          id: "studio",
          value: {
            label: "Open in Studio",
            icon: SlidersHorizontalIcon,
            run: (backdrop) => navigate(studioPath(backdrop)),
          },
        }),
      ],
      { discard: true },
    ),
});
