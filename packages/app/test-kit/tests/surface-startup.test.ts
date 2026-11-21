import { expect, onTestFinished, test } from "bun:test";
import { makeKernel } from "@kb/plugin";
import { Effect, Exit } from "effect";
import { serveRoot, type LiveUi } from "../src/surface-contract.ts";

test("interrupting a tab waiting for hello closes the socket and its server", async () => {
  const connected = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, listener) {
      return listener.upgrade(request) ? undefined : new Response(null, { status: 400 });
    },
    websocket: {
      open: () => connected.resolve(),
      message: () => undefined,
      close: () => disconnected.resolve(),
    },
  });
  onTestFinished(() => server.stop(true));
  let stopped = false;
  const ui: LiveUi = {
    at: { kind: "tcp", hostname: "127.0.0.1", port: server.port ?? 0 },
    hosted: { rows: Effect.succeed([]), kernel: makeKernel({ host: "server" }) },
    stop: async () => {
      await disconnected.promise;
      await server.stop(true);
      stopped = true;
    },
  };

  const controller = new AbortController();
  const running = Effect.runPromiseExit(
    Effect.scoped(serveRoot(() => Promise.resolve(ui), ".", "tcp")),
    { signal: controller.signal },
  );
  await connected.promise;
  controller.abort();
  expect(Exit.hasInterrupts(await running)).toBe(true);
  expect(stopped).toBe(true);
});
