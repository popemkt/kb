import type { BackdropProps, ThemeArtProps } from "@kb/ui-sdk";
import { deferred } from "@kb/theme-art";

/*
 * What the Transistor family contributes for its theme's art, each piece
 * loaded when first drawn (`deferred`). The ground and a head draw a frame
 * at once; the veil draws nothing until it has a gesture to play.
 * GAP [[01M5SNSQ4Y11AHAHDA43PCV5D6]] the art's words and gestures are code
 */

const CloudbankGround = deferred(
  () => import("./transistor-art").then((m) => m.CloudbankGround),
  true,
);
const JauntVeil = deferred(() => import("./transistor-art").then((m) => m.JauntVeil));
const CloudbankHead = deferred<BackdropProps>(
  () => import("./cloudbank-backdrop").then((m) => m.CloudbankBackdrop),
  true,
);
const OvcHead = deferred<BackdropProps>(
  () => import("./ovc-backdrop").then((m) => m.OvcBackdrop),
  true,
);

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

/** The head Transistor pairs with. */
export function CloudbankBackdrop(props: BackdropProps) {
  return <CloudbankHead {...props} />;
}

/** Transistor's other head. */
export function OvcBackdrop(props: BackdropProps) {
  return <OvcHead {...props} />;
}
