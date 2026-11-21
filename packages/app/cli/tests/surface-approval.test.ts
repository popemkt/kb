import { expect, onTestFinished, test } from "bun:test";
import type { ActionReceipt, UiListener } from "@kb/contracts";
import { answerApproval } from "./surfaces.ts";

test("ending the approval lifetime aborts a pending post and prevents further posts or receipts", async () => {
  const posted = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests += 1;
      posted.resolve();
      return response.promise;
    },
  });
  const controller = new AbortController();
  onTestFinished(async () => {
    controller.abort();
    response.resolve(Response.json({ status: "succeeded", id: "kb.manifest", output: {} }));
    await server.stop(true);
  });

  const at: UiListener = { kind: "tcp", hostname: "127.0.0.1", port: server.port ?? 0 };
  const invocation = { id: "kb.manifest", input: {}, approved: true };
  const receipts: ActionReceipt[] = [];
  const sendReceipt = (receipt: ActionReceipt) => {
    receipts.push(receipt);
  };
  const pending = answerApproval(at, invocation, controller.signal, sendReceipt);
  await posted.promise;
  controller.abort();

  // The peer still holds the response. Cancellation must release the client independently.
  expect(await pending.catch((error: unknown) => error)).toMatchObject({ name: "AbortError" });
  const late = answerApproval(at, invocation, controller.signal, sendReceipt);
  expect(await late.catch((error: unknown) => error)).toMatchObject({
    name: "AbortError",
  });
  expect(requests).toBe(1);
  expect(receipts).toEqual([]);
});
