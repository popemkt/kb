/**
 * `node.add`'s `matching` (DESIGN.md → Query layer → What a match requires),
 * over every store backend: the node takes what the query's conditions
 * require, goes under the parent a `child-of` names, and the query answers
 * it; what cannot be written is counted, never guessed.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { ActionReceipt, KbContext } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import { lowerIr, printEdn, type Condition } from "@kb/query";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { openKb } from "../src/session.ts";
import { STORE_BACKENDS, createStore, type StoreBackend } from "../src/store-selection.ts";

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

async function freshKb(backend: StoreBackend): Promise<KbContext> {
  const root = await mkdtemp(join(tmpdir(), "kb-matching-"));
  roots.push(root);
  await Effect.runPromise(createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer)));
  const ctx = await openKb(root);
  // With days off, a node with no place goes to the top level.
  output(await invoke(ctx, { id: "extension.switch", input: { name: "days", on: false } }));
  return ctx;
}

function output(receipt: ActionReceipt): Record<string, unknown> {
  if (receipt.status !== "succeeded") {
    throw new Error(`${receipt.status}: ${JSON.stringify(receipt)}`);
  }
  return receipt.output as Record<string, unknown>;
}

async function call(ctx: KbContext, id: string, input: unknown): Promise<Record<string, unknown>> {
  return output(await invoke(ctx, { id, input }));
}

const idOf = (out: Record<string, unknown>) => String(out.id);

/** A tag, a status field whose options are Open and Doing, and an inbox. */
async function schema(ctx: KbContext) {
  const tag = idOf(await call(ctx, "tag.define", { name: "task" }));
  const status = idOf(await call(ctx, "field.define", { name: "status" }));
  await call(ctx, "node.update", {
    id: status,
    setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: { t: "ref", v: SYSTEM_IDS.ftRef } }],
  });
  const open = idOf(await call(ctx, "node.add", { text: "Open", parent: status }));
  const doing = idOf(await call(ctx, "node.add", { text: "Doing", parent: status }));
  const inbox = idOf(await call(ctx, "node.add", { text: "Inbox", parent: null }));
  return { tag, status, open, doing, inbox };
}

async function queryNode(ctx: KbContext, edn: string): Promise<string> {
  const out = await call(ctx, "node.add", {
    text: "a search",
    parent: null,
    props: [{ field: SYSTEM_IDS.queryField, value: { t: "str", v: edn } }],
  });
  return idOf(out);
}

const ednOf = (conditions: readonly Condition[]) => printEdn(lowerIr(conditions));

function matchingContract(backend: StoreBackend) {
  describe(`node.add matching a query (${backend})`, () => {
    test("the node takes the query's tag, value and parent, and the query answers it", async () => {
      const ctx = await freshKb(backend);
      const s = await schema(ctx);
      const edn = ednOf([
        { kind: "has-tag", tag: s.tag },
        { kind: "field-is", field: s.status, values: [{ t: "ref", v: s.doing }] },
        { kind: "child-of", node: s.inbox },
      ]);
      const query = await queryNode(ctx, edn);
      const added = await call(ctx, "node.add", { text: "write the spec", matching: query });
      expect(added.unmet).toBe(0);
      const id = idOf(added);
      const node = ctx.nodes.find((n) => n.id === id);
      expect(node?.props[SYSTEM_IDS.typeField]).toEqual([{ t: "ref", v: s.tag }]);
      expect(node?.props[s.status]).toEqual([{ t: "ref", v: s.doing }]);
      expect(ctx.nodes.find((n) => n.id === s.inbox)?.children).toContain(id);
      const answer = await call(ctx, "graph.query", { query: edn });
      expect(JSON.stringify(answer)).toContain(id);
    });

    test("a parent the input names wins over the query's child-of", async () => {
      const ctx = await freshKb(backend);
      const s = await schema(ctx);
      const query = await queryNode(ctx, ednOf([{ kind: "child-of", node: s.inbox }]));
      const id = idOf(await call(ctx, "node.add", { text: "x", matching: query, parent: null }));
      expect(ctx.nodes.some((n) => n.children.includes(id))).toBe(false);
    });

    test("what a write cannot choose is counted unmet and left alone", async () => {
      const ctx = await freshKb(backend);
      const s = await schema(ctx);
      const query = await queryNode(
        ctx,
        ednOf([
          { kind: "has-tag", tag: s.tag },
          { kind: "lacks-tag", tag: s.tag },
          {
            kind: "field-is",
            field: s.status,
            values: [
              { t: "ref", v: s.open },
              { t: "ref", v: s.doing },
            ],
          },
        ]),
      );
      const added = await call(ctx, "node.add", { text: "x", matching: query });
      expect(added.unmet).toBe(2);
      const node = ctx.nodes.find((n) => n.id === idOf(added));
      expect(node?.props[s.status]).toBeUndefined();
    });

    test("a query that does not lift requires nothing and is one unmet condition", async () => {
      const ctx = await freshKb(backend);
      const query = await queryNode(ctx, "[:find ?t :where [?n :node/text ?t]]");
      const added = await call(ctx, "node.add", { text: "x", matching: query });
      expect(added.unmet).toBe(1);
    });

    test("matching a node that is no query is refused", async () => {
      const ctx = await freshKb(backend);
      const plain = idOf(await call(ctx, "node.add", { text: "plain", parent: null }));
      const receipt = await invoke(ctx, {
        id: "node.add",
        input: { text: "x", matching: plain },
      });
      expect(receipt.status).toBe("failed");
    });
  });
}

for (const backend of STORE_BACKENDS) matchingContract(backend);
