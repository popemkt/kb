/**
 * The desktop's half of the capture wire: pairing (`capture.pair`), the
 * envelope it sends to `capture.submit`, and how it reads each receipt,
 * against a stand-in host.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { DateTime, Effect } from "effect";
import {
  CAPTURE_CONTRACT,
  captureOutcome,
  localIsoTime,
  submitCapture,
  textCapture,
} from "../src/index.ts";
import { contractStatus, pairOutcome, pairWithHost } from "../src/core/capture.ts";

describe("localIsoTime", () => {
  test("is ISO-8601 with the local offset, and names the same instant", () => {
    const at = DateTime.makeUnsafe("2026-11-18T16:04:05.123Z");
    const iso = localIsoTime(at);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(new Date(iso).getTime()).toBe(DateTime.toEpochMillis(at));
  });
});

describe("textCapture", () => {
  test("keeps the text as typed and says the contract version", () => {
    const capture = textCapture("  line one\n  line two  ", DateTime.makeUnsafe(0), "c-1");
    expect(capture).toMatchObject({
      version: CAPTURE_CONTRACT,
      captureId: "c-1",
      source: { app: "kb desktop" },
      text: "  line one\n  line two  ",
    });
    expect(capture).not.toHaveProperty("target");
  });
});

describe("captureOutcome", () => {
  test("a succeeded receipt names the node", () => {
    expect(
      captureOutcome({
        status: "succeeded",
        output: { captureId: "c", nodeId: "n1", store: "Personal" },
      }),
    ).toEqual({ ok: true, nodeId: "n1", store: "Personal" });
  });

  test("a host without the action says kb needs updating", () => {
    const outcome = captureOutcome({
      status: "failed",
      code: "unknown_action",
      message: "unknown action: capture.submit",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.message).toContain("update kb");
  });

  test("any other refusal is the host's message", () => {
    expect(
      captureOutcome({ status: "failed", code: "invalid_input", message: "no inbox" }),
    ).toEqual({
      ok: false,
      message: "no inbox",
    });
  });
});

function nothing(): void {}

describe("submitCapture", () => {
  let stop = nothing;
  afterEach(() => stop());

  test("posts one capture.submit call, with the bearer token when there is one", async () => {
    const seen: { auth: string | null; origin: string | null; body: unknown }[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        seen.push({
          auth: req.headers.get("authorization"),
          origin: req.headers.get("origin"),
          body: await req.json(),
        });
        return Response.json({
          status: "succeeded",
          output: { captureId: "c-2", nodeId: "n2", store: "S" },
          rev: 3,
        });
      },
    });
    stop = () => void server.stop(true);
    const capture = textCapture("hello", DateTime.makeUnsafe(0), "c-2");
    const outcome = await Effect.runPromise(
      submitCapture({ origin: `http://127.0.0.1:${server.port}`, token: "tok" }, capture),
    );
    expect(outcome).toEqual({ ok: true, nodeId: "n2", store: "S" });
    expect(seen).toEqual([
      { auth: "Bearer tok", origin: null, body: { id: "capture.submit", input: capture } },
    ]);
  });

  test("a host that cannot be reached is a failure with the reason, not a throw", async () => {
    const outcome = await Effect.runPromise(
      submitCapture(
        { origin: "http://127.0.0.1:9" },
        textCapture("x", DateTime.makeUnsafe(0), "c-3"),
      ),
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("pairWithHost", () => {
  let stop = nothing;
  afterEach(() => stop());

  test("trades the code for a credential as a program, and reads the contract the host accepts", async () => {
    const seen: { auth: string | null; origin: string | null; body: unknown }[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        seen.push({
          auth: req.headers.get("authorization"),
          origin: req.headers.get("origin"),
          body: await req.json(),
        });
        return Response.json({
          status: "succeeded",
          output: {
            token: "kbcap_x",
            deviceId: "d1",
            store: { key: "01S", name: "Scratch" },
            captureContract: 1,
          },
        });
      },
    });
    stop = () => void server.stop(true);
    const outcome = await Effect.runPromise(
      pairWithHost(`http://127.0.0.1:${server.port}`, "ab".repeat(16), "kb desktop on m"),
    );
    expect(outcome).toEqual({
      ok: true,
      token: "kbcap_x",
      deviceId: "d1",
      store: { key: "01S", name: "Scratch" },
      accepts: [1],
    });
    expect(seen).toEqual([
      {
        auth: null,
        origin: null,
        body: {
          id: "capture.pair",
          input: { code: "ab".repeat(16), deviceName: "kb desktop on m" },
        },
      },
    ]);
  });

  test("a refusal, a kb without capture.pair and an unreachable host are outcomes with why", async () => {
    expect(pairOutcome({ status: "failed", code: "forbidden", message: "code used" })).toEqual({
      ok: false,
      message: "code used",
    });
    expect(pairOutcome({ status: "failed", code: "unknown_action" })).toEqual({
      ok: false,
      message: "this store's kb has no capture.pair yet; update kb on its host",
    });
    const unreachable = await Effect.runPromise(
      pairWithHost("http://127.0.0.1:9", "0".repeat(32), "m"),
    );
    expect(unreachable.ok).toBe(false);
  });
});

describe("contractStatus", () => {
  test("says whether the host takes this app's captures", () => {
    expect(contractStatus([1])).toBe("Accepts v1 · in step with this app");
    expect(contractStatus([])).toBe("Capture contract not confirmed yet (this app sends v1)");
    expect(contractStatus([2])).toBe("Accepts v2; this app sends v1, so captures are refused");
  });

  test("a refused credential says to pair again", () => {
    expect(
      captureOutcome({
        status: "failed",
        code: "forbidden",
        message: "capture device credential is invalid or revoked",
      }),
    ).toEqual({
      ok: false,
      message:
        "capture device credential is invalid or revoked. Pair this store again: forget it in Stores, and add it with a new code from its host.",
    });
  });
});
