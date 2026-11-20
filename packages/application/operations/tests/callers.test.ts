/**
 * Caller admission and projection in the invoke core (`ActionDefinition.callers`,
 * `ActionDefinition.callerOutput`): enforced
 * through the invocation contract for every surface, without relying on an HTTP
 * service context.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Logger } from "effect";
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
  test.each(["output", "projection", "defect"])(
    "capture receipts hide %s schema diagnostics",
    async (phase) => {
      const privateValue = "private graph value";
      const Output = z.object({ privateValue: z.string() });
      const Reject = Output.refine(() => false, {
        message: privateValue,
        path: ["privateValue"],
      });
      const projection =
        phase === "defect"
          ? {
              "~standard": {
                ...Output["~standard"],
                validate: () => Promise.reject(new Error(privateValue)),
              },
            }
          : Reject;
      const id = "diagnostic.output";
      const actions = new Map<string, RegisteredAction<never>>([
        [
          id,
          {
            def: {
              id,
              title: "Diagnostic output",
              description: "Returns a value that a schema rejects.",
              mode: { kind: "read" },
              callers: ["program", "capture-device", "capture-pairing"],
              callerOutput: { "capture-device": projection, "capture-pairing": projection },
              inputSchema: z.object({}),
              outputSchema: phase === "output" ? Reject : Output,
            },
            effect: () => Effect.succeed({ privateValue }),
            source: "core",
            aliases: [],
          },
        ],
      ]);
      const logs: unknown[] = [];
      const logger = Logger.make(({ message }) => logs.push(message));
      for (const wire of [DEVICE_WIRE, { ...DEVICE_WIRE, caller: "capture-pairing" } as const]) {
        const receipt = await Effect.runPromise(
          invokeReceiptWith(actions, FAKE_CTX, onWire(wire, { id, input: {} })).pipe(
            Effect.provide(Logger.layer([logger])),
          ),
        );
        expect(receipt).toEqual({
          status: "failed",
          id,
          code: "internal",
          message: "capture action output is invalid",
        });
      }
      expect(JSON.stringify(logs)).toContain(privateValue);
      if (phase !== "defect") expect(JSON.stringify(logs)).toContain('"path":["privateValue"]');
      const ordinary = await Effect.runPromise(
        invokeReceiptWith(actions, FAKE_CTX, onWire(PROGRAM_WIRE, { id, input: {} })),
      );
      if (phase === "output") expect(JSON.stringify(ordinary)).toContain(privateValue);
      else expect(ordinary).toMatchObject({ status: "succeeded", output: { privateValue } });
    },
  );

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

  test("nested calls inherit the outer caller and enforce callers + callerOutput", async () => {
    const nestedActions: Map<string, RegisteredAction<never>> = new Map<
      string,
      RegisteredAction<never>
    >([
      [
        "ordinary.secret",
        {
          def: {
            id: "ordinary.secret",
            title: "Ordinary secret",
            description: "Defaults to person and program only.",
            mode: { kind: "read" },
            inputSchema: z.object({}),
            outputSchema: z.object({ secret: z.string() }),
          },
          effect: () => Effect.succeed({ secret: "private" }),
          source: "core",
          aliases: [],
        },
      ],
      [
        "projected.info",
        {
          def: {
            id: "projected.info",
            title: "Projected info",
            description: "Projects output for capture-device callers.",
            mode: { kind: "read" },
            callers: ["person", "program", "capture-device"],
            callerOutput: {
              "capture-device": z.object({ public: z.string() }),
            },
            inputSchema: z.object({}),
            outputSchema: z.object({ public: z.string(), secret: z.string() }),
          },
          effect: () => Effect.succeed({ public: "ok", secret: "hidden" }),
          source: "core",
          aliases: [],
        },
      ],
      [
        "device.outer",
        {
          def: {
            id: "device.outer",
            title: "Device outer",
            description: "Calls another action while running under capture-device.",
            mode: { kind: "read" },
            callers: ["person", "program", "capture-device"],
            inputSchema: z.object({ target: z.string() }),
            outputSchema: z.object({ inner: z.unknown() }),
          },
          effect: (input: { target: string }) =>
            invokeReceiptWith(nestedActions, FAKE_CTX, {
              id: input.target,
              input: {},
              actor: "cli",
            }).pipe(Effect.map((inner) => ({ inner }))),
          source: "core",
          aliases: [],
        },
      ],
    ]);

    // A capture-device action cannot escalate to an ordinary-only action via a nested call.
    const blocked = await Effect.runPromise(
      invokeReceiptWith(
        nestedActions,
        FAKE_CTX,
        onWire(DEVICE_WIRE, { id: "device.outer", input: { target: "ordinary.secret" } }),
      ),
    );
    expect(blocked).toMatchObject({
      status: "succeeded",
      output: { inner: { status: "failed", code: "forbidden" } },
    });

    // A nested call to an admitted action still applies callerOutput projection.
    const projected = await Effect.runPromise(
      invokeReceiptWith(
        nestedActions,
        FAKE_CTX,
        onWire(DEVICE_WIRE, { id: "device.outer", input: { target: "projected.info" } }),
      ),
    );
    expect(projected).toMatchObject({
      status: "succeeded",
      output: { inner: { status: "succeeded", output: { public: "ok" } } },
    });
    if (projected.status === "succeeded") {
      const inner = (projected.output as { inner: { output: unknown } }).inner;
      expect(inner.output).toEqual({ public: "ok" });
    }
  });
});
