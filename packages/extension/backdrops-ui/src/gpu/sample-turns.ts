/**
 * Samples' scenes start one at a time (DESIGN-UI.md → Page-head backdrops →
 * GPU scenes). A sample is a scene drawn to be chosen by (`HeldStill`: an
 * option card, a gallery's), and a GPU scene's start compiles its materials
 * on the main thread, in its first frame. A gallery shows many at once, so
 * started together they would hold the main thread for all of their
 * compiles in a row, and the page's own timers (a crossfade letting its old
 * backdrop go) would wait behind every one. In turns, each starts once the
 * one before has settled, in a task of its own, so the page runs between
 * any two. A page head's scene is no sample and starts at once.
 */

/** The turn the next sample waits for: released once the last sample's start settles or its sample goes. */
let last: Promise<unknown> = Promise.resolve();

/** The page's turn: a task of its own, after every timer already due. */
const yieldToPage = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/** Settles when `signal` aborts (at once, if it has). */
const whenAborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

/**
 * Start a sample's scene in its turn. Aborted before its turn comes, it
 * never starts. Its turn is released to the next sample once its start
 * settles or its sample goes, whichever is first, and never before the
 * turns ahead of it: a start that hangs on a page left behind holds no
 * sample on the next page. A start that resolves after its sample went
 * still resolves, so whoever holds it (`attachScene`) disposes the scene.
 */
export function inTurn<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const ahead = last;
  const turn = ahead.then(yieldToPage).then(() => {
    signal.throwIfAborted();
    return start();
  });
  last = ahead.then(() =>
    Promise.race([
      turn.then(
        () => undefined,
        () => undefined,
      ),
      whenAborted(signal),
    ]),
  );
  return turn;
}
