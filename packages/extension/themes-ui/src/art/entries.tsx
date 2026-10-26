import type { BackdropProps, ThemeArtProps } from "@kb/ui-sdk";
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

/** ZZZ's art (DESIGN-UI.md → Themes): the street under the page, its gestures over it. */
export function ZzzArt({ plane, activity, path }: ThemeArtProps) {
  return plane === "ground" ? <StreetGround /> : <StreetVeil activity={activity} path={path} />;
}

/** Transistor's art (DESIGN-UI.md → Themes): Cloudbank under the page, Turn() over it. */
export function TransistorArt({ plane, activity, path }: ThemeArtProps) {
  return plane === "ground" ? <CloudbankGround activity={activity} /> : <JauntVeil path={path} />;
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
  return plane === "ground" ? (
    <YorhaGround activity={activity} />
  ) : (
    <YorhaVeil activity={activity} path={path} />
  );
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
