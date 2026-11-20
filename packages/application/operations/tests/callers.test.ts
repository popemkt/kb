/**
 * Caller admission and projection in the invoke core (`ActionDefinition.callers`,
 * `ActionDefinition.callerOutput`, `ActionDefinition.carriesApproval`): enforced
 * through the invocation contract for every surface, without relying on an HTTP
 * service context.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { PAGE_WIRE, onWire, type KbContext, type SurfaceWire } from "@kb/contracts";
import type { NodeIndex } from "@kb/query";
import { invokeReceiptWith, type RegisteredAction } from "../src/invoke.ts";

const PROGRAM_WIRE: SurfaceWire = { carriesApproval: false, actor: "cli", caller: "program" };
const MCP_LIKE_WIRE: SurfaceWire = { carriesApproval: false, actor: "agent", caller: "program" };
const DEVICE_WIRE: SurfaceWire = {
  carriesApproval: false,
  actor: "agent",
  caller: "capture-device",
};

const FAKE_CTX = { root: "/tmp/kb-callers-test", nodes: [] } as unknown as KbContext<NodeIndex>;

const ACTIONS = new Map<string, RegisteredAction<never>>([
  [
    "person.only",
    {
      def: {
        id: "person.only",
        title: "Person only",
        description: "Admits only browser person sessions.",
        mode: { kind: "read" },
        callers: ["person"],
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
      },
      effect: () => Effect.succeed({ ok: true }),
      source: "core",
      aliases: [],
    },
  ],
  [
    "device.only",
    {
      def: {
        id: "device.only",
        title: "Device only",
        description: "Admits only paired capture devices.",
        mode: { kind: "read" },
        callers: ["capture-device"],
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
      },
      effect: () => Effect.succeed({ ok: true }),
      source: "core",
      aliases: [],
    },
  ],
]);

describe("action caller enforcement through the invocation contract", () => {
  test("enforces callers on CLI/MCP/replica wires and when invocation.caller is omitted", async () => {
    // Omitted caller on an agent/cli invocation defaults to "program", never "allow all".
    const omittedProgram = await Effect.runPromise(
      invokeReceiptWith(ACTIONS, FAKE_CTX, { id: "person.only", input: {}, actor: "cli" }),
    );
    expect(omittedProgram).toMatchObject({ status: "failed", code: "forbidden" });

    const omittedDevice = await Effect.runPromise(
      invokeReceiptWith(ACTIONS, FAKE_CTX, { id: "device.only", input: {}, actor: "agent" }),
    );
    expect(omittedDevice).toMatchObject({ status: "failed", code: "forbidden" });

    // Omitted caller on a human invocation defaults to "person".
    const omittedPerson = await Effect.runPromise(
      invokeReceiptWith(ACTIONS, FAKE_CTX, { id: "person.only", input: {}, actor: "human" }),
    );
    expect(omittedPerson).toMatchObject({ status: "succeeded", output: { ok: true } });

    // Explicit surface wires enforce declarations consistently across CLI, MCP, replica, and device.
    expect(
      await Effect.runPromise(
        invokeReceiptWith(
          ACTIONS,
          FAKE_CTX,
          onWire(PROGRAM_WIRE, { id: "person.only", input: {} }),
        ),
      ),
    ).toMatchObject({ status: "failed", code: "forbidden" });
    expect(
      await Effect.runPromise(
        invokeReceiptWith(
          ACTIONS,
          FAKE_CTX,
          onWire(MCP_LIKE_WIRE, { id: "device.only", input: {} }),
        ),
      ),
    ).toMatchObject({ status: "failed", code: "forbidden" });
    expect(
      await Effect.runPromise(
        invokeReceiptWith(ACTIONS, FAKE_CTX, onWire(PAGE_WIRE, { id: "person.only", input: {} })),
      ),
    ).toMatchObject({ status: "succeeded", output: { ok: true } });
    expect(
      await Effect.runPromise(
        invokeReceiptWith(ACTIONS, FAKE_CTX, onWire(DEVICE_WIRE, { id: "device.only", input: {} })),
      ),
    ).toMatchObject({ status: "succeeded", output: { ok: true } });
  });
});
