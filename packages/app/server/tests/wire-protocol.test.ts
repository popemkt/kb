/**
 * The wire's version is a decision, not a guess (DESIGN-UI.md → Delivery,
 * "A tab outlives its build"). A page of the previous build keeps working
 * against this server as long as `WIRE_PROTOCOL` is the same, so whatever
 * such a page sends or reads is fingerprinted here: the socket's messages,
 * the action envelope and its answer, the snapshot, and each action a page
 * runs on its own replica, by id, mode and input.
 *
 * When this test fails, the wire changed. Decide which it is:
 * - a page of the previous build still works with it (a new optional field,
 *   a new message it ignores): record the new fingerprint below;
 * - it does not: bump `WIRE_PROTOCOL` in `@kb/contracts` and record both.
 *   Every open tab then reloads into the new build when it is idle.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  ActionRequestSchema,
  ActionResponseSchema,
  ClientMessageSchema,
  GraphSnapshotSchema,
  ServerMessageSchema,
  WIRE_PROTOCOL,
} from "@kb/contracts";
import { schemaToJsonSchema } from "@kb/model";
import { isomorphicActions } from "@kb/operations";

const RECORDED = {
  protocol: 1,
  fingerprint: "e66c529c0efd39cb459daa0ca5e17088fe09c9b649dde58edc59d89f552a1f91",
};

/** JSON with every object's keys sorted, so the fingerprint is the shape's, not its order's. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** Every shape as a parser reads it: the side a page and a server each accept. */
// GAP [[01M6GY0MXXXY2YQ8C3P77M2QNF]] the sandbox frame's messages are not fingerprinted, and its script is not digest-named
function wireFingerprint(): string {
  const wire = {
    client: schemaToJsonSchema(ClientMessageSchema, "input"),
    server: schemaToJsonSchema(ServerMessageSchema, "input"),
    request: schemaToJsonSchema(ActionRequestSchema, "input"),
    response: schemaToJsonSchema(ActionResponseSchema, "input"),
    snapshot: schemaToJsonSchema(GraphSnapshotSchema, "input"),
    replicaActions: isomorphicActions
      .map(({ def }) => ({
        id: def.id,
        mode: def.mode,
        input: schemaToJsonSchema(def.inputSchema, "input"),
      }))
      .toSorted((a, b) => (a.id < b.id ? -1 : 1)),
  };
  return createHash("sha256").update(canonical(wire)).digest("hex");
}

describe("the wire protocol", () => {
  test("is the version recorded with the wire it names", () => {
    const now = { protocol: WIRE_PROTOCOL, fingerprint: wireFingerprint() };
    expect(now, "the wire changed: see the comment at the top of this file").toEqual(RECORDED);
  });
});
