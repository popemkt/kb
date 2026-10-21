/**
 * Where the page's query engine runs: in a Web Worker (`engine/index.worker.ts`),
 * behind the port the replica's `RemoteIndex` holds, so no query, however
 * slow, holds up the page, and one that overruns its budget is stopped
 * (DESIGN-UI.md → Replica queries). A host with no workers (a test's page)
 * provides the engine in its own thread instead (`provideEngine`).
 */
import { bundledDerived } from "@kb/bundled";
import type { KbNode } from "@kb/model";
import { type EnginePort, type FromEngine, RemoteIndex, type Timers } from "@kb/ui-sdk";

/** The engine in a fresh Web Worker. */
function workerEngine(): EnginePort {
  const worker = new Worker(new URL("../engine/index.worker.ts", import.meta.url), {
    type: "module",
  });
  return {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no origin
    send: (message) => worker.postMessage(message),
    listen: (hear, failed) => {
      worker.addEventListener("message", (event: MessageEvent<FromEngine>) => hear(event.data));
      worker.addEventListener("error", failed);
    },
    terminate: () => worker.terminate(),
  };
}

let spawn: () => EnginePort = workerEngine;

/** Run the page's engine behind `next` from the next replica on: a host with no workers. */
export function provideEngine(next: () => EnginePort): void {
  spawn = next;
}

/** The page's timers, as the replica times a run's budget with them. */
const pageTimers: Timers = {
  set: (run, ms) => {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  },
};

/**
 * The page's replica over `nodes`: the node set here, its engine behind the
 * port the page provides, deriving what the bundled families declare
 * (`bundledDerived`), as the server's index does, so References agree.
 */
export function replicaOver(nodes: readonly KbNode[]): RemoteIndex {
  // GAP [[01M549TK1WP4E6T4QHNDRSDYQA]] the page and client derive ownership from the bundled fold only
  return new RemoteIndex(nodes, bundledDerived(), () => spawn(), pageTimers);
}
