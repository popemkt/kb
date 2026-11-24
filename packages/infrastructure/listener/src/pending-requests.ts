/** Keep transports' asynchronous handlers alive until their shared session can be released. */
export function pendingRequests() {
  const active = new Map<Promise<unknown>, number>();
  return {
    run<A>(start: () => Promise<A>): Promise<A> {
      const started = performance.now();
      const pending = start();
      const tracked = pending.finally(() => {
        active.delete(tracked);
      });
      active.set(tracked, started);
      return tracked;
    },
    snapshot() {
      const oldest = active.values().next().value;
      return {
        inFlight: active.size,
        oldestRequestMs: oldest === undefined ? 0 : Math.round(performance.now() - oldest),
      };
    },
    settle: () => Promise.allSettled(active.keys()).then(() => undefined),
  };
}
