import type { BackdropProps, ThemeArtProps } from "@kb/ui-sdk";
import { deferred } from "./deferred";

/*
 * What the themes family contributes for its two whole themes' art, each
 * piece loaded when first drawn (`deferred`). A ground and a head draw a
 * frame at once; a veil draws nothing until it has a gesture to play.
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
const TurnVeil = deferred(() => import("./transistor-art").then((m) => m.TurnVeil));

/** ZZZ's art (DESIGN-UI.md → Themes): the street under the page, its gestures over it. */
export function ZzzArt({ plane, activity, path }: ThemeArtProps) {
  return plane === "ground" ? <StreetGround /> : <StreetVeil activity={activity} path={path} />;
}

/** Transistor's art (DESIGN-UI.md → Themes): Cloudbank under the page, Turn() over it. */
export function TransistorArt({ plane, activity, path }: ThemeArtProps) {
  return plane === "ground" ? <CloudbankGround activity={activity} /> : <TurnVeil path={path} />;
}

const BroadcastHead = deferred<BackdropProps>(
  () => import("./broadcast-backdrop").then((m) => m.BroadcastBackdrop),
  "kb-art-frame",
);
const CloudbankHead = deferred<BackdropProps>(
  () => import("./cloudbank-backdrop").then((m) => m.CloudbankBackdrop),
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
