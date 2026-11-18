/** Keep transports' asynchronous handlers alive until their shared session can be released. */
export function pendingRequests() {
  const active = new Set<Promise<unknown>>();
  return {
    run<A>(start: () => Promise<A>): Promise<A> {
      const pending = start();
      active.add(pending);
      return pending.finally(() => {
        active.delete(pending);
      });
    },
    settle: () => Promise.allSettled(active).then(() => undefined),
  };
}
