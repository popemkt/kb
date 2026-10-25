import type { BackdropProps, PageActivity, ThemeArtProps } from "@kb/ui-sdk";
import { deferred } from "./deferred";

/*
 * What the themes family contributes for its whole themes' art, each piece
 * loaded when first drawn (`deferred`). A ground and a head draw a frame at
 * once; a veil draws nothing until it has a gesture to play.
 * GAP [[01M5SNSQ4Y11AHAHDA43PCV5D6]] the art's words and gestures are code
 */

const StreetGround = deferred(
  () => import("./zzz-art").then((m) => m.StreetGround),
  "kb-art-frame",
);
const StreetVeil = deferred(() => import("./zzz-art").then((m) => m.StreetVeil));
const CloudbankGround = deferred(
  () => import("./transistor-art").then((m) => m.CloudbankGround),
  "kb-art-frame",
);
const JauntVeil = deferred(() => import("./transistor-art").then((m) => m.JauntVeil));
const YorhaGround = deferred(
  () => import("./yorha-art").then((m) => m.YorhaGround),
  "kb-art-frame",
);
const YorhaVeil = deferred(() => import("./yorha-art").then((m) => m.YorhaVeil));

/*
 * A veil component plays both kinds of passing gesture: a write's, keyed on
 * the activity, and a page change's, keyed on the path. The window's veil
 * hears only the activity (its path never changes), and each pane's plane
 * only its own path (its activity never does), so a write plays once over
 * the window and a page change only in the pane whose page changed.
 */
const STILL: PageActivity = { editing: false, writes: 0 };
const NOWHERE = "";

/** ZZZ's art (DESIGN-UI.md → Themes): the street under the page, its gestures over it. */
export function ZzzArt({ plane, activity, path }: ThemeArtProps) {
  switch (plane) {
    case "ground":
      return <StreetGround />;
    case "veil":
      return <StreetVeil activity={activity} path={NOWHERE} />;
    case "pane":
      return <StreetVeil activity={STILL} path={path} />;
    default:
      return plane satisfies never;
  }
}

/** Transistor's art (DESIGN-UI.md → Themes): Cloudbank under the page, Jaunt() over a pane. */
export function TransistorArt({ plane, activity, path }: ThemeArtProps) {
  switch (plane) {
    case "ground":
      return <CloudbankGround activity={activity} />;
    case "veil":
      return null;
    case "pane":
      return <JauntVeil path={path} />;
    default:
      return plane satisfies never;
  }
}

const BroadcastHead = deferred<BackdropProps>(
  () => import("./broadcast-backdrop").then((m) => m.BroadcastBackdrop),
  "kb-art-frame",
);
const CloudbankHead = deferred<BackdropProps>(
  () => import("./cloudbank-backdrop").then((m) => m.CloudbankBackdrop),
  "kb-art-frame",
);

/** YoRHa's art (DESIGN-UI.md → Themes): the Bunker's grid under the page, its HUD over it. */
export function YorhaArt({ plane, activity, path }: ThemeArtProps) {
  switch (plane) {
    case "ground":
      return <YorhaGround activity={activity} />;
    case "veil":
      return <YorhaVeil activity={activity} path={NOWHERE} />;
    case "pane":
      return <YorhaVeil activity={STILL} path={path} />;
    default:
      return plane satisfies never;
  }
}

const HollowHead = deferred<BackdropProps>(
  () => import("./hollow-backdrop").then((m) => m.HollowBackdrop),
  "kb-art-frame",
);
const OvcHead = deferred<BackdropProps>(
  () => import("./ovc-backdrop").then((m) => m.OvcBackdrop),
  "kb-art-frame",
);
const BunkerHead = deferred<BackdropProps>(
  () => import("./bunker-backdrop").then((m) => m.BunkerBackdrop),
  "kb-art-frame",
);
const ArenaHead = deferred<BackdropProps>(
  () => import("./arena-backdrop").then((m) => m.ArenaBackdrop),
  "kb-art-frame",
);

/** The head ZZZ pairs with. */
export function BroadcastBackdrop(props: BackdropProps) {
  return <BroadcastHead {...props} />;
}

/** The head Transistor pairs with. */
export function CloudbankBackdrop(props: BackdropProps) {
  return <CloudbankHead {...props} />;
}

/** ZZZ's other head. */
export function HollowBackdrop(props: BackdropProps) {
  return <HollowHead {...props} />;
}

/** Transistor's other head. */
export function OvcBackdrop(props: BackdropProps) {
  return <OvcHead {...props} />;
}

/** The head YoRHa pairs with. */
export function BunkerBackdrop(props: BackdropProps) {
  return <BunkerHead {...props} />;
}

/** YoRHa's other head. */
export function ArenaBackdrop(props: BackdropProps) {
  return <ArenaHead {...props} />;
}
