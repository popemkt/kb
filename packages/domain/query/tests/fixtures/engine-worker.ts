/**
 * A query engine in a Bun Worker, as the page's runs in a Web Worker: the
 * remote index contract runs over this port as well as the in-thread one.
 */
import { derivedWith, serveIndex, type ToEngine } from "@kb/query";

declare const self: {
  addEventListener(type: "message", listener: (event: { data: ToEngine }) => void): void;
  postMessage(message: unknown): void;
};

const serve = serveIndex(
  { derived: derivedWith({}) },
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin
  (message) => self.postMessage(message),
  () => performance.now(),
);
self.addEventListener("message", (event) => serve(event.data));
