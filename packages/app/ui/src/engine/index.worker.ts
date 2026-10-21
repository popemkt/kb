/**
 * The page's query engine: the replica's `DatascriptIndex`, in a Web Worker,
 * kept in step with the node set the page holds and asked its queries
 * (`@kb/query` → `serveIndex`; DESIGN-UI.md → Replica queries). Its clock
 * is the page's: Effect's default `Clock` and the person's own time zone, so
 * `kb/today` in a query the page runs is the person's today.
 */
import { Effect } from "effect";
import { bundledDerived } from "@kb/bundled";
import { clockSampler } from "@kb/model";
import { serveIndex, type ToEngine } from "@kb/query";

declare const self: {
  addEventListener(type: "message", listener: (event: { data: ToEngine }) => void): void;
  postMessage(message: unknown): void;
};

const serve = serveIndex(
  // GAP [[01M549TK1WP4E6T4QHNDRSDYQA]] the page and client derive ownership from the bundled fold only
  { derived: bundledDerived(), clock: Effect.runSync(clockSampler) },
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin
  (message) => self.postMessage(message),
  () => performance.now(),
);
self.addEventListener("message", (event) => serve(event.data));
