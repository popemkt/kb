import type { BackdropDirection } from "@kb/model";
import type { BackdropPresentation } from "./plugins";

/**
 * How far down its frame a card's window looks (frame pixels), `shown`
 * pixels of it tall: at what a head's picture is composed round. A backdrop
 * that faces a way hangs down to the line its head's content begins on,
 * past its breathing room (`space`), or rises up to it from below, so its
 * window is centred on that line from the side it faces; one with no
 * direction composes its hero in the breathing room, so its window is the
 * frame's top. Never past the frame's top or bottom.
 */
export function cardWindowTop(
  { space, height, directions }: BackdropPresentation,
  direction: BackdropDirection,
  shown: number,
): number {
  if (directions.length === 0) return 0;
  const line = direction === "up" ? height - space : space;
  return Math.min(Math.max(0, line - shown / 2), Math.max(0, height - shown));
}
