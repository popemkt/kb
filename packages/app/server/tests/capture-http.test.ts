import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import {
  ActionPoint,
  ActionReceiptSchema,
  CAPTURE_CONTRACT,
  CAPTURE_PAIR,
  CAPTURE_PAIR_CODE,
  CAPTURE_REVOKE,
  CAPTURE_SUBMIT,
  CapturePairReceiptSchema,
  CaptureReceiptSchema,
  defineExtension,
  extensionNamespace,
  provideAction,
  type ExtensionEntry,
} from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
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

const deviceEchoDecl = defineExtension({ name: "device-echo", label: "Device Echo" });
const DEVICE_ECHO: ExtensionEntry = {
  declaration: deviceEchoDecl,
  entry: definePlugin({
    name: deviceEchoDecl.name,
    namespace: extensionNamespace(deviceEchoDecl.name),
    apply: (ctx) =>
      Effect.all(
        [
          ctx.contribute(
            ActionPoint,
            provideAction({
              id: "ping",
              title: "Device ping",
              description: "Admits paired capture devices via declaration, with no server edit.",
              mode: { kind: "read" },
              callers: ["person", "program", "capture-device"],
              inputSchema: {
                parse: Schema.decodeUnknownSync(Schema.Struct({ note: Schema.String })),
              },
              outputSchema: {
                parse: Schema.decodeUnknownSync(Schema.Struct({ pong: Schema.String })),
              },
              effect: (input: { note: string }) => Effect.succeed({ pong: input.note }),
            }),
          ),
          ctx.contribute(
            ActionPoint,
            provideAction({
              id: "private",
              title: "Private action",
              description: "Omits callers, so defaults to person and program only.",
              mode: { kind: "read" },
              inputSchema: { parse: (v: unknown) => v },
              outputSchema: {
                parse: Schema.decodeUnknownSync(Schema.Struct({ secret: Schema.Boolean })),
              },
              effect: () => Effect.succeed({ secret: true }),
            }),
          ),
        ],
        { discard: true },
      ),
  }),
};

function postAction(base: string, id: string, input: unknown = {}, token?: string) {
  return fetch(`${base}/api/action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ id, input }),
  });
}

test("a new action declaring device access is admitted with no server edit, and undeclared actions are refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-capture-declared-"));
  const ctx = await openKb(root);
  const captureOnly = await Effect.runPromise(
    startUi({ root, port: 0, captureOnly: true, extensions: [DEVICE_ECHO] }),
  );
  const mainUi = await Effect.runPromise(
    startUi({ root, port: 0, openBrowser: false, extensions: [DEVICE_ECHO] }),
  );
  try {
    // Pair against the main kb ui listener (one store URL serves both UI and capture).
    const issued = await invoke(ctx, { id: CAPTURE_PAIR_CODE, input: {} });
    if (issued.status !== "succeeded") throw new Error(JSON.stringify(issued));
    const { code } = issued.output as { code: string };
    const pairRes = await postAction(mainUi.url, CAPTURE_PAIR, { code, deviceName: "Android" });
    expect(pairRes.status).toBe(200);
    expect(pairRes.headers.get("cache-control")).toBe("no-store");
    const paired = await read(pairRes);
    if (paired.status !== "succeeded") throw new Error(JSON.stringify(paired));
    const { token, store } = CapturePairReceiptSchema.parse(paired.output);

    // Main kb ui listener accepts a paired device credential for discovery and capture.
    const mainManifest = await read(await postAction(mainUi.url, "kb.manifest", {}, token));
    expect(mainManifest).toMatchObject({
      status: "succeeded",
      output: { captureContract: CAPTURE_CONTRACT },
    });
    if (mainManifest.status === "succeeded") {
      expect(mainManifest.output).toEqual({ captureContract: CAPTURE_CONTRACT });
    }
    const share = {
      captureId: crypto.randomUUID(),
      capturedAt: "2026-11-20T12:00:00Z",
      text: "Captured on the main UI URL",
      target: { store: store.key },
    };
    const submitted = await read(await postAction(mainUi.url, CAPTURE_SUBMIT, share, token));
    expect(submitted).toMatchObject({ status: "succeeded" });

    // Main kb ui listener still serves regular UI/program callers normally.
    expect((await fetch(`${mainUi.url}/api/graph`)).status).toBe(200);
    expect(
      (await fetch(`${mainUi.url}/api/graph`, { headers: { Authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(403);

    // The newly declared device action works on both --capture-only and main kb ui with no server edit.
    for (const base of [captureOnly.url, mainUi.url]) {
      const ok = await postAction(base, "ext.device-echo.ping", { note: "hello" }, token);
      expect(ok.status).toBe(200);
      expect(await read(ok)).toMatchObject({ status: "succeeded", output: { pong: "hello" } });

      // Undeclared action is refused with the same 403 text.
      const denied = await postAction(base, "ext.device-echo.private", {}, token);
      expect(denied.status).toBe(403);
      expect(await read(denied)).toMatchObject({
        status: "failed",
        code: "forbidden",
        message: "this listener or credential only admits capture actions",
      });
    }

    // Without a device credential on --capture-only, device-only action is refused.
    expect(
      (await postAction(captureOnly.url, "ext.device-echo.ping", { note: "anon" })).status,
    ).toBe(403);
    // With a device credential, capture.pair is refused (pairing-only on capture wire).
    expect(
      (await postAction(captureOnly.url, CAPTURE_PAIR, { code, deviceName: "Dup" }, token)).status,
    ).toBe(403);
  } finally {
    await Effect.runPromise(captureOnly.stop);
    await Effect.runPromise(mainUi.stop);
    await rm(root, { recursive: true, force: true });
  }
});
