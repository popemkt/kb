/**
 * A store's kept state is an optimisation, never a source of truth: moved by
 * the transactions a store commits, it answers every question exactly as a
 * state built afresh from the nodes those transactions leave, and rank
 * settling over it — the transaction laid over the stored state — settles
 * exactly as it would over that state already applied.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { KbNode, NodeId } from "../src/model.ts";
import { rankTx } from "../src/order.ts";
import { StoreState } from "../src/store-state.ts";
import { applyTx, type StoreTx } from "../src/tx.ts";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: NodeId, children: NodeId[], order?: string, text = id): KbNode {
  return {
    id,
    text,
    props: {},
    children,
    ...(order === undefined ? {} : { order }),
    createdAt: AT,
    updatedAt: AT,
  };
}

/** A forest over `n` nodes: node i's parent is an earlier node or none, some ranked, some not. */
const forestArb = fc
  .array(fc.record({ parent: fc.option(fc.nat()), ranked: fc.boolean() }), {
    minLength: 1,
    maxLength: 12,
  })
  .map((specs) => {
    const ids = specs.map((_, i) => `n${String(i).padStart(2, "0")}`);
    const children = new Map<NodeId, NodeId[]>(ids.map((id) => [id, []]));
    specs.forEach((spec, i) => {
      if (i === 0 || spec.parent === null) return;
      children.get(ids[spec.parent % i] ?? "")?.push(ids[i] ?? "");
    });
    return specs.map((spec, i) => {
      const id = ids[i] ?? "";
      return node(id, children.get(id) ?? [], spec.ranked ? `a${String(i)}` : undefined);
    });
  });

type Step =
  | { kind: "edit"; at: number }
  | { kind: "add"; under: number | null; serial: number }
  | { kind: "move"; at: number; to: number | null }
  | { kind: "drop"; at: number; tidy: boolean }
  | { kind: "unwrap"; at: number }
  | { kind: "release"; at: number };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("edit" as const), at: fc.nat() }),
  fc.record({ kind: fc.constant("add" as const), under: fc.option(fc.nat()), serial: fc.nat() }),
  fc.record({ kind: fc.constant("move" as const), at: fc.nat(), to: fc.option(fc.nat()) }),
  fc.record({ kind: fc.constant("drop" as const), at: fc.nat(), tidy: fc.boolean() }),
  fc.record({ kind: fc.constant("unwrap" as const), at: fc.nat() }),
  fc.record({ kind: fc.constant("release" as const), at: fc.nat() }),
);

function parentIn(nodes: Map<NodeId, KbNode>, id: NodeId): KbNode | undefined {
  for (const n of nodes.values()) if (n.children.includes(id)) return n;
  return undefined;
}

function within(nodes: Map<NodeId, KbNode>, root: NodeId, id: NodeId): boolean {
  if (root === id) return true;
  return (nodes.get(root)?.children ?? []).some((c) => within(nodes, c, id));
}

const NOTHING: StoreTx = { upserts: [], deletes: [] };

function addTx(nodes: Map<NodeId, KbNode>, under: NodeId | null, serial: number): StoreTx {
  const id = `new${String(serial)}`;
  const parent = under === null ? undefined : nodes.get(under);
  return {
    upserts: [
      node(id, []),
      ...(parent === undefined ? [] : [{ ...parent, children: [...parent.children, id] }]),
    ],
    deletes: [],
  };
}

function moveTx(nodes: Map<NodeId, KbNode>, current: KbNode, to: KbNode | undefined): StoreTx {
  const id = current.id;
  if (to !== undefined && within(nodes, id, to.id)) return NOTHING;
  const from = parentIn(nodes, id);
  const upserts: KbNode[] = [];
  if (from !== undefined)
    upserts.push({ ...from, children: from.children.filter((c) => c !== id) });
  const target = to === undefined ? undefined : (upserts.find((n) => n.id === to.id) ?? to);
  if (target !== undefined) {
    const moved = { ...target, children: [...target.children.filter((c) => c !== id), id] };
    const at = upserts.findIndex((n) => n.id === moved.id);
    if (at >= 0) upserts[at] = moved;
    else upserts.push(moved);
  }
  upserts.push(current);
  return { upserts, deletes: [] };
}

/** A leaf deleted, its parent tidied or left naming it. */
function dropTx(nodes: Map<NodeId, KbNode>, current: KbNode, tidy: boolean): StoreTx {
  if (current.children.length > 0) return NOTHING;
  const from = parentIn(nodes, current.id);
  const tidied =
    tidy && from !== undefined
      ? [{ ...from, children: from.children.filter((c) => c !== current.id) }]
      : [];
  return { upserts: tidied, deletes: [current.id] };
}

/**
 * A node deleted and its children handed to its parent (or the roots),
 * written as they are: their stored parent is the one gone.
 */
function unwrapTx(nodes: Map<NodeId, KbNode>, current: KbNode): StoreTx {
  const upserts = current.children.flatMap((c) => nodes.get(c) ?? []);
  const from = parentIn(nodes, current.id);
  if (from !== undefined) {
    const at = from.children.indexOf(current.id);
    const children = [
      ...from.children.slice(0, at),
      ...current.children,
      ...from.children.slice(at + 1),
    ];
    upserts.push({ ...from, children });
  }
  return { upserts, deletes: [current.id] };
}

/** A parent lets go of a child without the child being written: a root now. */
function releaseTx(current: KbNode): StoreTx {
  const child = current.children[0];
  if (child === undefined) return NOTHING;
  return {
    upserts: [{ ...current, children: current.children.filter((c) => c !== child) }],
    deletes: [],
  };
}

/** A transaction a person could make of `nodes`, keeping it a forest. */
function txOf(nodes: Map<NodeId, KbNode>, step: Step, serial: number): StoreTx {
  const ids = [...nodes.keys()];
  const pick = (i: number) => ids[i % ids.length] ?? "";
  if (step.kind === "add" || ids.length === 0) {
    const under =
      step.kind === "add" && step.under !== null && ids.length > 0 ? pick(step.under) : null;
    return addTx(nodes, under, serial);
  }
  const current = nodes.get(pick(step.at));
  if (current === undefined) return NOTHING;
  switch (step.kind) {
    case "edit":
      return { upserts: [{ ...current, text: `${current.text}!` }], deletes: [] };
    case "move":
      return moveTx(nodes, current, step.to === null ? undefined : nodes.get(pick(step.to)));
    case "drop":
      return dropTx(nodes, current, step.tidy);
    case "unwrap":
      return unwrapTx(nodes, current);
    case "release":
      return releaseTx(current);
    default:
      return NOTHING;
  }
}

function rootIds(state: StoreState): (NodeId | undefined)[] {
  const roots = state.roots();
  return Array.from({ length: roots.length }, (_, i) => roots.at(i)?.id);
}

function sameState(kept: StoreState, fresh: StoreState, ids: Iterable<NodeId>): void {
  expect([...kept.values()].map((n) => n.id).toSorted()).toEqual(
    [...fresh.values()].map((n) => n.id).toSorted(),
  );
  for (const id of ids) {
    expect(kept.get(id)).toEqual(fresh.get(id));
    expect(kept.parentOf(id)).toBe(fresh.parentOf(id));
  }
  expect(rootIds(kept)).toEqual(rootIds(fresh));
}

describe("StoreState", () => {
  test("moved by commits, it answers as a state built afresh, and settles ranks alike", () => {
    fc.assert(
      fc.property(forestArb, fc.array(stepArb, { maxLength: 8 }), (forest, steps) => {
        const kept = StoreState.of(forest);
        let nodes = new Map(forest.map((n) => [n.id, n]));
        steps.forEach((step, serial) => {
          const tx = txOf(nodes, step, serial);
          const applied = rankTx(kept, tx);
          // Laid over the stored state, or applied first: one settlement.
          const settledAfter = rankTx(StoreState.of(applyTx([...nodes.values()], tx).values()), tx);
          expect(applied).toEqual(settledAfter);

          kept.apply(applied);
          nodes = applyTx([...nodes.values()], applied);
          const touched = new Set([...nodes.keys(), ...tx.deletes, ...tx.upserts.map((n) => n.id)]);
          sameState(kept, StoreState.of(nodes.values()), touched);
        });
      }),
      { numRuns: 400 },
    );
  });
});
