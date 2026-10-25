import { Suspense, lazy, type ComponentType } from "react";

/**
 * A component whose code loads the first time it is drawn, so the page's
 * eager bundle carries none of a theme's art until a page shows that theme
 * (DESIGN-UI.md → Delivery). It draws nothing while it loads. Given a
 * `frame` class, a box of that class is drawn at once around it, for a slot
 * that counts what it was handed.
 */
export function deferred<P extends object>(
  load: () => Promise<ComponentType<P>>,
  frame?: string,
): ComponentType<P> {
  const Loaded = lazy(() => load().then((Component) => ({ default: Component })));
  function Deferred(props: P) {
    const drawn = (
      <Suspense fallback={null}>
        <Loaded {...props} />
      </Suspense>
    );
    return frame === undefined ? drawn : <div className={frame}>{drawn}</div>;
  }
  return Deferred;
}
