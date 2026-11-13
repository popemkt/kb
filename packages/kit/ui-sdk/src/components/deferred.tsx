import { Suspense, lazy, type ComponentType, type ReactNode } from "react";

/** What a deferred component draws while its code loads. */
interface DeferredOptions {
  /** Drawn in its place until it has loaded (none, nothing). */
  readonly fallback?: ReactNode;
  /** The class of a box drawn at once around it, for a slot that counts what it was handed. */
  readonly frame?: string;
}

/**
 * A component whose code loads the first time it is drawn, so the page's
 * eager bundle carries none of it until a page shows it (DESIGN-UI.md →
 * Delivery): a theme's art, or a kit part only some surfaces draw. The kit's
 * barrel is the page's host module, so every part it exports is in that
 * bundle; a part it exports deferred costs it only this.
 */
export function deferred<P extends object>(
  load: () => Promise<ComponentType<P>>,
  { fallback = null, frame }: DeferredOptions = {},
): ComponentType<P> {
  const Loaded = lazy(() => load().then((Component) => ({ default: Component })));
  function Deferred(props: P) {
    const drawn = (
      <Suspense fallback={fallback}>
        <Loaded {...props} />
      </Suspense>
    );
    return frame === undefined ? drawn : <div className={frame}>{drawn}</div>;
  }
  return Deferred;
}
