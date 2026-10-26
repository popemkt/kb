import { usePageActivity, useShownDesignSystem } from "../hooks";
import type { ThemeArtPlane } from "../lib/plugins";
import { usePath } from "../lib/router";

/**
 * The one art slot (DESIGN-UI.md → Design tokens → Themes): one plane of
 * the art of the design system painting the page. The shell names no
 * system: it renders the `ground` under everything it draws, the `veil`
 * over everything, and a `pane` plane over each pane with that pane's own
 * `path`; the last two for passing gestures only. A system with no art,
 * or none shown yet, draws nothing. Either plane takes no input and is
 * hidden from assistive technology: it is decoration, and what it reacts to
 * (an edit, a write, a page change) it is told.
 */
export function ThemeArt({
  plane,
  path: own,
}: {
  readonly plane: ThemeArtPlane;
  /** The pane's own path, for its `pane` plane; else the focused pane's. */
  readonly path?: string;
}) {
  const system = useShownDesignSystem();
  const activity = usePageActivity();
  const focused = usePath();
  const path = own ?? focused;
  if (system?.Art === undefined) return null;
  const { Art } = system;
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ contain: "strict", containerType: "size" }}
      data-theme-art={system.key.id}
      data-plane={plane}
      aria-hidden="true"
    >
      <Art plane={plane} activity={activity} path={path} />
    </div>
  );
}
