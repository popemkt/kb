import type { ReactElement } from "react";
import type { BackdropProps, ThemeArtProps } from "@kb/ui-sdk";
import { NOWHERE, STILL, deferred } from "@kb/theme-art";

/*
 * What the ZZZ family contributes for its theme's art, each piece loaded
 * when first drawn (`deferred`). The ground and a head draw a frame at
 * once; the veil draws nothing until it has a gesture to play.
 * GAP [[01M5SNSQ4Y11AHAHDA43PCV5D6]] the art's words and gestures are code
 */

const StreetGround = deferred(() => import("./zzz-art").then((m) => m.StreetGround), true);
const StreetVeil = deferred(() => import("./zzz-art").then((m) => m.StreetVeil));
const BroadcastHead = deferred<BackdropProps>(
  () => import("./broadcast-backdrop").then((m) => m.BroadcastBackdrop),
  true,
);
const HollowHead = deferred<BackdropProps>(
  () => import("./hollow-backdrop").then((m) => m.HollowBackdrop),
  true,
);

/** ZZZ's art (DESIGN-UI.md → Themes): the street under the page, its gestures over it. */
export function ZzzArt({ plane, activity, path }: ThemeArtProps): ReactElement | null {
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

/** The head ZZZ pairs with. */
export function BroadcastBackdrop(props: BackdropProps): ReactElement | null {
  return <BroadcastHead {...props} />;
}

/** ZZZ's other head. */
export function HollowBackdrop(props: BackdropProps): ReactElement | null {
  return <HollowHead {...props} />;
}
