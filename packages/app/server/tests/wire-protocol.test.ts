/**
 * The wire's version is a decision, not a guess (DESIGN-UI.md → Delivery,
 * "A tab outlives its build"). A page of the previous build keeps working
 * against this server as long as `WIRE_PROTOCOL` is the same, so whatever
 * such a page sends or reads is fingerprinted here: the socket's messages,
 * the action envelope and its answer, the snapshot, and every action the
 * server offers, which a page may call or run on its own replica, by id,
 * mode, input and output, as the server's own manifest lists them.
 *
 * When this test fails, the wire changed. Decide which it is:
 * - a page of the previous build still works with it (a new optional field,
 *   a new message it ignores): record the new fingerprint below;
 * - it does not: bump `WIRE_PROTOCOL` in `@kb/contracts` and record both.
 *   Every open tab then reloads into the new build when it is idle.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  ActionRequestSchema,
  ActionResponseSchema,
  ClientMessageSchema,
  GraphSnapshotSchema,
  ServerMessageSchema,
  WIRE_PROTOCOL,
} from "@kb/contracts";
import { schemaToJsonSchema } from "@kb/model";
import { startUi, type UiServerHandle } from "../src/index.ts";

// Older pages reject unknown notification frames. Protocol 3 reloads them
// into a build that follows manifest-changed and refreshes its catalog.
const RECORDED = {
  protocol: 3,
  fingerprint: "dc186c808951547fe76ba28c89f190d81c148286e7d20c617a8cb1594c0434eb",
};

/** JSON with every object's keys sorted, so the fingerprint is the shape's, not its order's. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** An action as the wire carries it: what a call sends and what its answer holds. */
interface ManifestAction {
  readonly id: string;
  readonly mode: unknown;
  readonly batchOf?: unknown;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
}

/** Every action the server offers, as its manifest lists them, each by what a call to it carries. */
async function offered(url: string): Promise<unknown[]> {
  const res = await fetch(`${url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(url).origin },
    body: JSON.stringify({ id: "kb.manifest", input: {} }),
  });
  const receipt = (await res.json()) as { output: { actions: ManifestAction[] } };
  return receipt.output.actions
    .map(({ id, mode, batchOf, inputSchema, outputSchema }) => ({
      id,
      mode,
      batchOf,
      input: inputSchema,
      output: outputSchema,
    }))
    .toSorted((a, b) => (a.id < b.id ? -1 : 1));
}

/** Every shape as a parser reads it: the side a page and a server each accept. */
// GAP [[01M6GY0MXXXY2YQ8C3P77M2QNF]] the sandbox frame's messages are not fingerprinted, and its script is not digest-named
function wireFingerprint(actions: unknown[]): string {
  const wire = {
    client: schemaToJsonSchema(ClientMessageSchema, "input"),
    server: schemaToJsonSchema(ServerMessageSchema, "input"),
    request: schemaToJsonSchema(ActionRequestSchema, "input"),
    response: schemaToJsonSchema(ActionResponseSchema, "input"),
    snapshot: schemaToJsonSchema(GraphSnapshotSchema, "input"),
    actions,
  };
  return createHash("sha256").update(canonical(wire)).digest("hex");
}

describe("the wire protocol", () => {
  let root = "";
  let handle: UiServerHandle;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-wire-"));
    handle = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false, builds: null }));
  });
  afterAll(async () => {
    await Effect.runPromise(handle.stop);
    await rm(root, { recursive: true, force: true });
  });

  test("is the version recorded with the wire it names", async () => {
    const actions = await offered(handle.url);
    expect(actions.length).toBeGreaterThan(50);
    const now = { protocol: WIRE_PROTOCOL, fingerprint: wireFingerprint(actions) };
    expect(now, "the wire changed: see the comment at the top of this file").toEqual(RECORDED);
  });
});
