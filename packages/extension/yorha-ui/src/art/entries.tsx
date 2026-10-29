import { QUIET_ACTIVITY, type BackdropProps, type ThemeArtProps } from "@kb/ui-sdk";
import { NOWHERE, deferred } from "@kb/theme-art";

/*
 * What the YoRHa family contributes for its theme's art, each piece loaded
 * when first drawn (`deferred`). The ground and a head draw a frame at
 * once; the veil draws nothing until it has a gesture to play.
 * GAP [[01M5SNSQ4Y11AHAHDA43PCV5D6]] the art's words and gestures are code
 */

const YorhaGround = deferred(() => import("./yorha-art").then((m) => m.YorhaGround), true);
const YorhaVeil = deferred(() => import("./yorha-art").then((m) => m.YorhaVeil));
const BunkerHead = deferred<BackdropProps>(
  () => import("./bunker-backdrop").then((m) => m.BunkerBackdrop),
  true,
);
const ArenaHead = deferred<BackdropProps>(
  () => import("./arena-backdrop").then((m) => m.ArenaBackdrop),
  true,
);

/** YoRHa's art (DESIGN-UI.md → Themes): the Bunker's grid under the page, its HUD over it. */
export function YorhaArt({ plane, activity, path }: ThemeArtProps) {
  switch (plane) {
    case "ground":
      return <YorhaGround activity={activity} />;
    case "veil":
      return <YorhaVeil activity={activity} path={NOWHERE} />;
    case "pane":
      return <YorhaVeil activity={QUIET_ACTIVITY} path={path} />;
    default:
      return plane satisfies never;
  }
}

/** The head YoRHa pairs with. */
export function BunkerBackdrop(props: BackdropProps) {
  return <BunkerHead {...props} />;
}

/** YoRHa's other head. */
export function ArenaBackdrop(props: BackdropProps) {
  return <ArenaHead {...props} />;
}
