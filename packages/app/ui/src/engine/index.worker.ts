/**
 * The page's query engine: the replica's `DatascriptIndex`, in a Web Worker,
 * kept in step with the node set the page holds and asked its queries
 * (`@kb/query` → `serveIndex`; DESIGN-UI.md → Replica queries).
 */
import { bundledDerived } from "@kb/bundled";
import { serveIndex, type ToEngine } from "@kb/query";

declare const self: {
  addEventListener(type: "message", listener: (event: { data: ToEngine }) => void): void;
  postMessage(message: unknown): void;
};

const serve = serveIndex(
  // GAP [[01M549TK1WP4E6T4QHNDRSDYQA]] the page and client derive ownership from the bundled fold only
  bundledDerived(),
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin
  (message) => self.postMessage(message),
  () => performance.now(),
);
self.addEventListener("message", (event) => serve(event.data));
