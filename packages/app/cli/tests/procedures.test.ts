import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import { ActionPoint, ProcedurePoint } from "@kb/contracts";
import { domainError } from "@kb/model";
import { definePlugin, makeKernel } from "@kb/plugin";
import { kbRuntimeLayer, openKbEffect, bunFileSystemLayer } from "@kb/runtime";
import { KB_SOURCE_BIN, writeTrustedExtension } from "@kb/test-kit";
import { walk } from "../src/procedures.ts";

for (const mode of ["failure", "stalled", "wrong-action"] as const) {
  test(`CLI walk stops once for ${mode}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-procedure-cli-"));
    let calls = 0;
    try {
      const plugin = definePlugin({
        name: "probe",
        namespace: "probe",
        apply: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.contribute(ActionPoint, {
              id: "check",
              value: {
                title: "Check",
                description: "Never done",
                mode: { kind: "read" },
                inputSchema: z.object({}),
                outputSchema: z.object({ done: z.boolean() }),
                effect: () => Effect.succeed({ done: false }),
              },
            });
            yield* ctx.contribute(ActionPoint, {
              id: "run",
              value: {
                title: "Run",
                description: "Count execution",
                mode: { kind: "write" },
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                effect: Effect.fn("probe.run")(function* () {
                  calls++;
                  if (mode === "failure" || calls > 1)
                    return yield* domainError("invalid_input", "probe failed");
                  return {};
                }),
              },
            });
            yield* ctx.contribute(ProcedurePoint, {
              id: "walk",
              value: {
                title: "Probe",
                steps: [
                  {
                    id: "one",
                    title: "One",
                    actions: [
                      { id: "run", title: "Run", call: { action: "probe.run", input: {} } },
                    ],
                    check: { action: "probe.check", input: {} },
                  },
                ],
              },
            });
          }),
      });
      const code = await Effect.runPromise(
        Effect.gen(function* () {
          const ctx = yield* openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer));
          const kernel = makeKernel({ host: "server" });
          yield* kernel.load(plugin);
          return yield* walk(ctx, {}, "probe.walk", {
            yes: true,
            once: false,
            action: mode === "wrong-action" ? "rollback" : undefined,
          }).pipe(
            Effect.provide(kbRuntimeLayer(ctx, undefined, { kernel, rows: Effect.succeed([]) })),
          );
        }),
      );
      expect(code).toBe(1);
      expect(calls).toBe(mode === "wrong-action" ? 0 : 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

/** A repository family whose one migration retitles the node `MIGRATED`. */
const MIGRATED = "01M7C2MB4ZFZK9FYX6BHHAKFWN";
const RETITLE = `import { defineExtension } from "kb-ext-sdk";
export const declaration = defineExtension({
  name: "retitle",
  label: "Retitle",
  migrations: [
    {
      id: "before-to-after",
      title: "Before to after",
      run: (graph) => {
        const node = graph.nodeOf("${MIGRATED}");
        return node === undefined || node.text !== "before"
          ? { upserts: [], deletes: [] }
          : { upserts: [{ ...node, text: "after", updatedAt: graph.at }], deletes: [] };
      },
    },
  ],
});
`;

test("a terminal approval mid-walk keeps a repository family's procedure, whatever the store's switches", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-procedure-approval-"));
  const kb = (...args: string[]) => [KB_SOURCE_BIN, "--root", root, ...args];
  // The children share this test's home and data, where its trust is kept.
  const env = { ...process.env };
  const settle = async (args: string[]) => {
    const child = Bun.spawn(kb(...args), { env, stdout: "pipe", stderr: "pipe" });
    expect({
      exit: await child.exited,
      stderr: await new Response(child.stderr).text(),
    }).toMatchObject({ exit: 0 });
  };
  try {
    await settle(["init"]);
    await settle(["add", "--top", "--id", MIGRATED, "before"]);
    // A family switched from its default: what the approval prompt once read
    // the catalog without, composing a second registry over the session's.
    await settle([
      "action-invoke",
      JSON.stringify({ id: "extension.switch", input: { name: "lab", on: true } }),
    ]);
    await writeTrustedExtension(root, "retitle.ts", RETITLE);
    let output = "";
    let answered = false;
    const child = Bun.spawn(
      kb("procedure", "migration.retitle.before-to-after", "--run", "--yes"),
      {
        env,
        terminal: {
          cols: 200,
          rows: 50,
          data(terminal, bytes) {
            output += new TextDecoder().decode(bytes);
            if (!answered && output.includes("Approve this call? [y/N]")) {
              answered = true;
              terminal.write("y\n");
            }
          },
        },
      },
    );
    try {
      await child.exited;
      expect(answered).toBe(true);
      expect(output).not.toContain("no procedure");
      expect(output).toContain("ran apply");
      expect(output).toContain("ran verify");
    } finally {
      child.kill();
      child.terminal?.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
