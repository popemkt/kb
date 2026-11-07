/**
 * The corner a page head's backdrop shows its actions in (DESIGN-UI.md →
 * Page-head backdrops → Its actions), once its owner double-clicks it
 * (`watchBackdropDoubleClick`): each action offered at
 * `BackdropActionPoint`, a small button in the head's top-right corner,
 * at `top` (`cornerTop`: inside the frame, clear of the title).
 * It asks for nothing: it fades after a few seconds unless the pointer or
 * focus is on it, Escape dismisses it, and it never takes focus.
 */
import { useEffect, useState } from "react";
import { CORNER_HEIGHT } from "../lib/backdrop-corner-place";
import { cn } from "../lib/cn";
import { BackdropActionPoint, useContributions } from "../lib/plugins";

/** How long the corner stays once shown, while nothing holds it. */
const CORNER_SHOWN_MS = 4000;
/** Its fade, after which it is gone. */
const FADE_MS = 300;

export function BackdropCorner({
  backdrop,
  top,
  onClose,
}: {
  /** The declared id of the backdrop the head shows. */
  readonly backdrop: string;
  /** Its top, in px from the top of the head's breathing room. */
  readonly top: number;
  readonly onClose: () => void;
}) {
  const actions = useContributions(BackdropActionPoint);
  // Two holds, each released by its own: the pointer leaving lets go of the pointer's, not focus's.
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = pointed || focused;
  const [fading, setFading] = useState(false);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  useEffect(() => {
    if (held) return undefined;
    const fade = setTimeout(() => setFading(true), CORNER_SHOWN_MS);
    const gone = setTimeout(onClose, CORNER_SHOWN_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
      setFading(false);
    };
  }, [held, onClose]);
  if (actions.length === 0) return null;
  return (
    <div
      className={cn(
        "pointer-events-auto absolute right-2 z-10 flex gap-1 transition-opacity duration-300 motion-reduce:transition-none",
        fading ? "opacity-0" : "opacity-100",
      )}
      style={{ top }}
      data-backdrop-corner={backdrop}
      onPointerEnter={() => setPointed(true)}
      onPointerLeave={() => setPointed(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => setFocused(event.currentTarget.contains(event.relatedTarget))}
    >
      {actions.map(({ id, value: { label, icon: Glyph, run } }) => (
        <button
          key={id}
          type="button"
          style={{ height: CORNER_HEIGHT }}
          className="flex items-center gap-1.5 rounded-md border border-foreground/10 bg-popover/85 px-2.5 text-meta text-foreground/75 shadow-lifted backdrop-blur-md hover:text-foreground focus-visible:outline focus-visible:outline-primary"
          onClick={() => {
            onClose();
            run(backdrop);
          }}
        >
          <Glyph size={13} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
