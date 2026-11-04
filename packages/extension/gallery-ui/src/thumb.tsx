/**
 * A visual's cover as a small picture: what a style chip or card is drawn
 * with, its example (`examplesOf`), so the library reads as a visual
 * dictionary.
 */
import { coverOf } from "@kb/gallery";
import { assetSrcUrl, cn } from "@kb/ui-sdk";
import type { ComposerFrame } from "./frame";

/** A picture of `visual`'s cover at `size`, or nothing: a chip with no example is its words alone. */
export function Thumb({
  frame,
  visual,
  size = "size-8",
}: {
  readonly frame: ComposerFrame;
  readonly visual: string | undefined;
  readonly size?: string;
}) {
  const node = visual === undefined ? undefined : frame.node(visual);
  const cover = node === undefined ? null : coverOf(node);
  if (cover === null) return null;
  return (
    <img
      src={assetSrcUrl(cover)}
      alt=""
      loading="lazy"
      className={cn(size, "shrink-0 rounded-md object-cover")}
    />
  );
}
