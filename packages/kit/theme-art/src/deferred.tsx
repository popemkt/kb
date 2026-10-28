import { Suspense, lazy, type ComponentType } from "react";

/** The class of the box a framed deferred piece is drawn in while it loads. */
const ART_FRAME = "kb-art-frame";

/**
 * A component whose code loads the first time it is drawn, so the page's
 * eager bundle carries none of a theme's art until a page shows that theme
 * (DESIGN-UI.md → Delivery). It draws nothing while it loads. `framed`,
 * a box (`ART_FRAME`) is drawn at once around it, for a slot that counts
 * what it was handed.
 */
export function deferred<P extends object>(
  load: () => Promise<ComponentType<P>>,
  framed = false,
): ComponentType<P> {
  const Loaded = lazy(() => load().then((Component) => ({ default: Component })));
  function Deferred(props: P) {
    const drawn = (
      <Suspense fallback={null}>
        <Loaded {...props} />
      </Suspense>
    );
    return framed ? <div className={ART_FRAME}>{drawn}</div> : drawn;
  }
  return Deferred;
}
