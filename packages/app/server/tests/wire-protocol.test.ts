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

// Protocol 4: an extension row carries its origin (kb's build and the host
// included), its one-line description, and a required family's reason in
// place of `optional`, which a page of protocol 3 requires, so it reloads
// into a build that reads them.
// The strict manifest now carries replacement claims; older pages must reload
// before they can approve a digest without seeing its replacement lines.
// Protocol 6: graph.changes carries identified reaction actors, alongside
// the existing human/agent/cli/script actor strings.
// Protocol 7: manifests carry scoped named-point dependencies and reaction
// matches; earlier strict readers cannot decode or review those claims.
// The days family adds an action (`ext.days.today`) a previous page ignores.
// The snapshot's `virtual` ids and the tx frame's `virtual` flag are optional:
// a previous page ignores them and holds every node as stored, as it did.
// `node.merge` is a new action: a previous page never calls it, and merges as
// it did, with the updates and the delete it is made of.
// `tag.define` takes the tags a new tag extends, an optional input a previous
// page never sends.
// Protocol 8: node.add and node.addTree read an omitted parent as the
// capture target (today's node with days), where a previous page meant the
// top level; its local commit and the server's would disagree, so it reloads.
// `store.backup`, `store.backups` and `store.restore` are new actions a
// previous page never calls.
// `procedure.list`, `procedure.status` and `procedure.step` are new actions a
// previous page never calls. `store.backups` answers whether each backup is
// pinned, a field a previous page ignores.
const RECORDED = {
  protocol: 8,
  fingerprint: "db0a49e1b4f50713e9cce83dd2d7ecded3a37e1efaf33719730450c749ec7caf",
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
