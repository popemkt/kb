import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  ActionReceiptSchema,
  CAPTURE_CONTRACT,
  CAPTURE_PAIR,
  CAPTURE_PAIR_CODE,
  CAPTURE_REVOKE,
  CAPTURE_SUBMIT,
  CapturePairReceiptSchema,
  CaptureReceiptSchema,
} from "@kb/contracts";
import { STORE_BACKENDS, bunFileSystemLayer, createStore, invoke, openKb } from "@kb/runtime";
import { startUi } from "../src/server.ts";

async function read(response: Response) {
  return ActionReceiptSchema.parse(await response.json());
}

for (const backend of STORE_BACKENDS) {
  test(`the capture HTTP wire pairs once, stays scoped, and observes revocation (${backend})`, async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-capture-http-"));
    await Effect.runPromise(createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer)));
    const ctx = await openKb(root);
    let handle = await Effect.runPromise(startUi({ root, port: 0, captureOnly: true }));
    try {
      const post = (id: string, input: unknown = {}, token?: string) =>
        fetch(`${handle.url}/api/action`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({ id, input, approved: true }),
        });
      const discovery = await read(await post("kb.manifest"));
      expect(discovery).toMatchObject({
        status: "succeeded",
        output: { captureContract: CAPTURE_CONTRACT },
      });
      if (discovery.status === "succeeded")
        expect(discovery.output).toEqual({ captureContract: 1 });

      expect((await post("node.add", { text: "forbidden" })).status).toBe(403);
      expect((await fetch(`${handle.url}/api/graph`)).status).toBe(403);
      expect((await post(CAPTURE_PAIR_CODE)).status).toBe(403);

      const issued = await invoke(ctx, { id: CAPTURE_PAIR_CODE, input: {} });
      if (issued.status !== "succeeded") throw new Error(JSON.stringify(issued));
      const { code } = issued.output as { code: string };
      const input = { code, deviceName: "Phone" };
      const paired = await read(await post(CAPTURE_PAIR, input));
      if (paired.status !== "succeeded") throw new Error(JSON.stringify(paired));
      const { token, deviceId, store } = CapturePairReceiptSchema.parse(paired.output);
      expect(await read(await post(CAPTURE_PAIR, input))).toMatchObject({
        status: "failed",
        code: "forbidden",
      });
      expect((await post("graph.search", { text: "query" }, token)).status).toBe(403);
      expect((await post("kb.manifest", {}, "kbcap_bad")).status).toBe(403);

      const share = {
        captureId: crypto.randomUUID(),
        capturedAt: "2026-11-18T01:00:00Z",
        text: "Hello from my phone",
        target: { store: store.key },
      };
      expect((await post(CAPTURE_SUBMIT, share)).status).toBe(403);
      const sent = await read(await post(CAPTURE_SUBMIT, share, token));
      if (sent.status !== "succeeded") throw new Error(JSON.stringify(sent));
      expect(CaptureReceiptSchema.parse(sent.output)).toMatchObject({
        captureId: share.captureId,
        store: store.key,
      });

      await Effect.runPromise(handle.stop);
      handle = await Effect.runPromise(startUi({ root, port: 0, captureOnly: true }));
      expect(await read(await post(CAPTURE_SUBMIT, share, token))).toEqual(sent);
      expect(await invoke(ctx, { id: CAPTURE_SUBMIT, input: share })).toMatchObject({
        status: "failed",
        code: "conflict",
      });
      expect(await invoke(ctx, { id: CAPTURE_REVOKE, input: { deviceId } })).toMatchObject({
        status: "succeeded",
      });
      expect((await post(CAPTURE_SUBMIT, share, token)).status).toBe(403);
      expect((await post("kb.manifest", {}, token)).status).toBe(403);
      expect(JSON.stringify(ctx.nodes)).not.toContain(token);
      expect(JSON.stringify(ctx.nodes)).not.toContain(code);
    } finally {
      await Effect.runPromise(handle.stop);
      await rm(root, { recursive: true, force: true });
    }
  });
}
