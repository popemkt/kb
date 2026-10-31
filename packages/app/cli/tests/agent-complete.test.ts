/**
 * `ext.agent.complete` over `kb ui` (DESIGN.md → Agent packages →
 * completion): the agent family's one-shot completion, contributed where the
 * server hosts the agent and reached like any other action. It runs one turn
 * of the provider the agent's node selects, here a scripted provider (no
 * model, no login, no network), with the caller's system prompt and one
 * message (with the pictures it names, read from the root's assets, and how
 * many the model was shown), no tools and no screen; it keeps a bounded
 * reply; a provider that fails, or whose binding nobody trusted here, fails
 * it by name; no sandboxed code may call it; and switched off with the
 * agent, it is gone.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  AGENT_IDS,
  DEFAULT_ADAPTER,
  adapterOptionId,
  agentExtension,
  agentPlugin,
  scriptedRuntime,
  type ScriptStep,
  type ScriptedRuntime,
} from "@kb/agent";
import { NO_SECRETS, type ExtensionEntry } from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import { bunFileSystemLayer } from "@kb/runtime";
import { startUi, type UiServerHandle } from "@kb/server";

const COMPLETE = "ext.agent.complete";
/** What the completion keeps of a reply, in characters (`COMPLETION_LIMITS.reply`). */
const REPLY_LIMIT = 32_000;

/** What the scripted provider says to a message. */
function script(text: string): readonly ScriptStep[] {
  if (text === "long") return [{ say: "x".repeat(REPLY_LIMIT - 1) }, { say: "yz" }];
  if (text === "fail") return [{ fail: "the model is down" }];
  return [{ say: "Hello" }, { say: ", there" }];
}

/** Every runtime the scripted adapter built, in order. */
const built: ScriptedRuntime[] = [];
/** Whether the next runtime the scripted adapter builds sees pictures. */
let sees = true;

const AGENT: ExtensionEntry = {
  declaration: agentExtension,
  entry: agentPlugin({
    adapters: [
      {
        id: DEFAULT_ADAPTER,
        login: () => [],
        runtime: () => {
          const runtime = scriptedRuntime((turn) => script(turn.message.text), { sees });
          built.push(runtime);
          return runtime;
        },
      },
    ],
    secrets: NO_SECRETS,
  }),
};

let root = "";
let handle: UiServerHandle;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-agent-complete-"));
  handle = await Effect.runPromise(
    startUi({ root, port: 0, openBrowser: false, extensions: [AGENT] }).pipe(
      Effect.provide(bunFileSystemLayer),
    ),
  );
});
afterAll(async () => {
  await Effect.runPromise(handle.stop);
  await rm(root, { recursive: true, force: true });
});

/** A call from the page, over HTTP as the page makes it, with `envelope` beside it: its receipt. */
async function call(
  id: string,
  input: unknown,
  envelope: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const origin = new URL(handle.url).origin;
  const response = await fetch(`${origin}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ id, input, ...envelope }),
  });
  return (await response.json()) as Record<string, unknown>;
}

describe("ext.agent.complete", () => {
  test("is listed where the agent is hosted, as a read that reaches outside the root", async () => {
    const receipt = await call(kbManifestDef.id, {});
    const entry = kbManifestDef.outputSchema
      .parse(receipt.output)
      .actions.find(({ id }) => id === COMPLETE);
    expect(entry?.mode).toEqual({ kind: "read", outsideRoot: true });
  });

  test("runs one turn of the provider: the caller's system prompt, one message, no tools, no screen", async () => {
    const from = built.length;
    expect(await call(COMPLETE, { system: "You title things.", message: "hi" })).toMatchObject({
      status: "succeeded",
      output: { text: "Hello, there", truncated: false, provider: "scripted", saw: 0 },
    });
    // A runtime of its own per call, so nothing of a call outlives it.
    expect(built).toHaveLength(from + 1);
    const [turn] = built[from]?.turns ?? [];
    expect(turn?.system).toBe("You title things.");
    expect(turn?.message).toEqual({ text: "hi", screen: null, images: [] });
    expect(turn?.resume).toBeUndefined();
    expect(turn?.tools).toEqual([]);
  });

  test("shows the model the pictures it names, read from the root's assets, and says how many", async () => {
    await mkdir(join(root, ".kb", "assets"), { recursive: true });
    await writeFile(join(root, ".kb", "assets", "pier.png"), new Uint8Array([137, 80, 78, 71]));
    await writeFile(join(root, ".kb", "assets", "dusk.JPG"), new Uint8Array([255, 216, 255]));
    const from = built.length;
    expect(
      await call(COMPLETE, { message: "hi", images: ["assets/pier.png", "assets/dusk.JPG"] }),
    ).toMatchObject({ status: "succeeded", output: { text: "Hello, there", saw: 2 } });
    expect(built[from]?.turns[0]?.message.images).toEqual([
      { mediaType: "image/png", data: "iVBORw==" },
      { mediaType: "image/jpeg", data: "/9j/" },
    ]);
  });

  test("a runtime that does not see answers from the text alone, and says it saw none", async () => {
    sees = false;
    try {
      const from = built.length;
      expect(await call(COMPLETE, { message: "hi", images: ["assets/pier.png"] })).toMatchObject({
        status: "succeeded",
        output: { text: "Hello, there", saw: 0 },
      });
      expect(built[from]?.turns[0]?.message.images).toEqual([]);
    } finally {
      sees = true;
    }
  });

  test("a picture that is no asset, no picture a model takes, missing or too large is refused before any model runs", async () => {
    await writeFile(join(root, ".kb", "assets", "logo.svg"), "<svg/>");
    await writeFile(join(root, ".kb", "assets", "huge.png"), new Uint8Array(5 * 1024 * 1024 + 1));
    const from = built.length;
    const refused = async (images: readonly string[]) =>
      ((await call(COMPLETE, { message: "hi", images })) as { code?: string }).code;
    expect(await refused(["https://example.com/a.png"])).toBe("invalid_input");
    expect(await refused(["assets/logo.svg"])).toBe("invalid_input");
    expect(await refused(["assets/none.png"])).toBe("not_found");
    expect(await refused(["assets/huge.png"])).toBe("invalid_input");
    expect(await refused(["assets/../nodes.jsonl.png"])).toBe("forbidden");
    expect(await refused(Array.from({ length: 5 }, () => "assets/pier.png"))).toBe("invalid_input");
    expect(built).toHaveLength(from);
  });

  test("without a system prompt, the model is told to answer and nothing more", async () => {
    const from = built.length;
    await call(COMPLETE, { message: "hi" });
    expect(built[from]?.turns[0]?.system).toMatch(/^Answer the message/);
  });

  test("keeps at most its bound of the reply, and says it cut it", async () => {
    const receipt = await call(COMPLETE, { message: "long" });
    expect(receipt).toMatchObject({ status: "succeeded", output: { truncated: true } });
    const { text } = receipt.output as { text: string };
    expect(text).toHaveLength(REPLY_LIMIT);
    expect(text.endsWith("xy")).toBe(true);
  });

  test("a provider that fails fails the call, saying why", async () => {
    expect(await call(COMPLETE, { message: "fail" })).toMatchObject({
      status: "failed",
      code: "internal",
      message: "the model is down",
    });
  });

  test("an input past its bounds is refused before any model runs", async () => {
    const from = built.length;
    expect(await call(COMPLETE, { message: "" })).toMatchObject({ code: "invalid_input" });
    expect(await call(COMPLETE, { message: "m".repeat(100_001) })).toMatchObject({
      code: "invalid_input",
    });
    expect(built).toHaveLength(from);
  });

  test("runs the selected provider only once its binding is trusted on this machine", async () => {
    const made = await call("node.add", {
      text: "Local proxy",
      tags: [AGENT_IDS.providerTag],
      props: [
        { field: AGENT_IDS.adapterField, value: { t: "ref", v: adapterOptionId(DEFAULT_ADAPTER) } },
        { field: AGENT_IDS.endpointField, value: { t: "str", v: "http://127.0.0.1:8317" } },
      ],
    });
    expect(made).toMatchObject({ status: "succeeded" });
    const { id } = made.output as { id: string };
    const select = (setProps: unknown[], unsetProps: unknown[] = []) =>
      call("node.update", { id: "sys.extension.agent", setProps, unsetProps });
    expect(
      await select([{ field: AGENT_IDS.providerField, value: { t: "ref", v: id } }]),
    ).toMatchObject({ status: "succeeded" });
    try {
      const from = built.length;
      expect(await call(COMPLETE, { message: "hi" })).toMatchObject({
        status: "failed",
        message: expect.stringContaining("not trusted on this machine"),
      });
      expect(built).toHaveLength(from);
    } finally {
      await select([], [{ field: AGENT_IDS.providerField }]);
    }
  });

  test("no sandboxed code may call it, whatever its grant names", async () => {
    const from = built.length;
    const receipt = await call(
      COMPLETE,
      { message: "hi" },
      { script: { subject: null, grant: { reads: "graph", actions: [COMPLETE] } } },
    );
    expect(receipt).toMatchObject({
      status: "failed",
      code: "forbidden",
      message: expect.stringContaining("no code may call it"),
    });
    expect(built).toHaveLength(from);
  });

  test("switched off with the agent, it leaves the listing and the registry", async () => {
    expect(await call("extension.switch", { name: "agent", on: false })).toMatchObject({
      status: "succeeded",
    });
    try {
      const listed = kbManifestDef.outputSchema
        .parse((await call(kbManifestDef.id, {})).output)
        .actions.map(({ id }) => id);
      expect(listed).not.toContain(COMPLETE);
      expect(await call(COMPLETE, { message: "hi" })).toMatchObject({ code: "unknown_action" });
    } finally {
      await call("extension.switch", { name: "agent", on: true });
    }
    expect(await call(COMPLETE, { message: "hi" })).toMatchObject({ status: "succeeded" });
  });
});
