/**
 * A family that only `kb ui` hosts contributes registry actions where it is
 * hosted (DESIGN.md → Plugin channels → hosted actions): what its plugin
 * contributes to `ActionPoint` in the server's kernel is listed by
 * `kb.manifest` and invoked over the API like any other action, a call an
 * action makes reaches it as a call from outside does, and an id the
 * registry already holds stays the registry's.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import {
  ActionPoint,
  CoreInvoke,
  defineExtension,
  extensionNamespace,
  provideAction,
  type ExtensionEntry,
} from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import { definePlugin } from "@kb/plugin";
import { startUi, type UiServerHandle } from "../src/index.ts";

const echo = defineExtension({ name: "echo", label: "Echo" });

/** An input of one string, `text`: the schema a bare `parse` states. */
const TextInput = { parse: Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String })) };
/** Any output, as given. */
const AnyOutput = { parse: (output: unknown): unknown => output };

/** A hosted family with two actions: one that answers, one that calls it through the invoke core. */
const ECHO: ExtensionEntry = {
  declaration: echo,
  entry: definePlugin({
    name: echo.name,
    namespace: extensionNamespace(echo.name),
    apply: (ctx) =>
      Effect.all(
        [
          ctx.contribute(
            ActionPoint,
            provideAction({
              id: "say",
              title: "Say",
              description: "Answer with what it was given.",
              mode: { kind: "read" },
              inputSchema: TextInput,
              outputSchema: AnyOutput,
              effect: (input: { text: string }) => Effect.succeed({ said: input.text }),
            }),
          ),
          ctx.contribute(
            ActionPoint,
            provideAction({
              id: "relay",
              title: "Relay",
              description: "Ask ext.echo.say through the invoke core, and answer what it said.",
              mode: { kind: "read" },
              inputSchema: TextInput,
              outputSchema: AnyOutput,
              effect: (input: { text: string }) =>
                Effect.gen(function* () {
                  const invoke = yield* CoreInvoke;
                  if (invoke === null) return { status: "no invoke core", output: null };
                  const receipt = yield* invoke({ id: "ext.echo.say", input }, "read");
                  return {
                    status: receipt.status,
                    output: receipt.status === "succeeded" ? receipt.output : receipt.message,
                  };
                }),
            }),
          ),
        ],
        { discard: true },
      ),
  }),
};

/** A hosted family that contributes an id the registry holds, in the root namespace. */
const SHADOW: ExtensionEntry = {
  declaration: defineExtension({ name: "shadow", label: "Shadow" }),
  entry: definePlugin({
    name: "shadow",
    namespace: "",
    apply: (ctx) =>
      ctx.contribute(
        ActionPoint,
        provideAction({
          id: "node.get",
          title: "Not node.get",
          description: "A second node.get, which the registry's keeps.",
          mode: { kind: "read" },
          inputSchema: AnyOutput,
          outputSchema: AnyOutput,
          effect: () => Effect.succeed({ shadow: true as const }),
        }),
      ),
  }),
};

let root = "";
let handle: UiServerHandle;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-hosted-actions-"));
  handle = await Effect.runPromise(
    startUi({ root, port: 0, openBrowser: false, extensions: [ECHO, SHADOW] }),
  );
});
afterAll(async () => {
  await Effect.runPromise(handle.stop);
  await rm(root, { recursive: true, force: true });
});

/** A call from the page, over HTTP as the page makes it: its receipt. */
async function call(id: string, input: unknown): Promise<Record<string, unknown>> {
  const origin = new URL(handle.url).origin;
  const response = await fetch(`${origin}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ id, input }),
  });
  return (await response.json()) as Record<string, unknown>;
}

describe("a hosted family's actions", () => {
  test("are listed by kb.manifest beside the registry's", async () => {
    const receipt = await call(kbManifestDef.id, {});
    expect(receipt.status).toBe("succeeded");
    const ids = kbManifestDef.outputSchema.parse(receipt.output).actions.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining(["node.get", "ext.echo.say", "ext.echo.relay"]));
    expect(ids.filter((id) => id === "node.get")).toHaveLength(1);
  });

  test("are invoked over the API like any other", async () => {
    expect(await call("ext.echo.say", { text: "hi" })).toMatchObject({
      status: "succeeded",
      output: { said: "hi" },
    });
    expect(await call("ext.echo.say", {})).toMatchObject({
      status: "failed",
      code: "invalid_input",
    });
  });

  test("are reached by a call an action makes", async () => {
    expect(await call("ext.echo.relay", { text: "again" })).toMatchObject({
      status: "succeeded",
      output: { status: "succeeded", output: { said: "again" } },
    });
  });

  test("never take an id the registry holds", async () => {
    const receipt = await call("node.get", { id: "sys.tag", depth: 0 });
    expect(receipt).toMatchObject({ status: "succeeded", output: { node: { id: "sys.tag" } } });
  });
});
