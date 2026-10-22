/**
 * How many query runs an edit costs, and how long they take: the page's
 * workload (DESIGN-UI.md → Replica queries) replayed against one index.
 *
 * A set of watched queries — query nodes, a view's family query, the
 * builder's condition rows — is asked again after every edit, as the page
 * asks every watched query when the replica moves. The edits are a seeded
 * mix of what a person does: type into a node, add one, set a status, tag
 * one, move one, delete one. The table says, per graph, how many queries were
 * asked, how many the engine actually ran, and the time it spent answering.
 *
 * Like the store benchmark it prints and asserts nothing, and it runs only
 * in the bench lane (`bun run bench`). `KB_BENCH_STORE` names a
 * `nodes.jsonl` to replay over besides kb's own store and a generated one.
 */
import { describe, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledDerived, bundledSeed } from "@kb/bundled";
import { SYSTEM_IDS, type ClockSample, type KbNode, type StoreTx } from "@kb/model";
const writeOut = (line: string): void => void process.stdout.write(`${line}\n`);
import { DatascriptIndex, lowerIr, printEdn, type Condition } from "@kb/query";
import { benchmarkEnabled } from "@kb/test-kit";

const AT = "2026-01-01T00:00:00.000Z";
const CLOCK: ClockSample = { nowMs: Date.UTC(2026, 0, 10, 12), timeZone: "UTC" };
const EDITS = 300;
const GENERATED = 20_000;

/** A small deterministic PRNG, so two runs replay the same edits. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readStore(path: string): KbNode[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as KbNode);
}

/** A seeded outline: a tree of `n` nodes, a tenth of them todos with a status and a due date, some mentioning others. */
function generated(n: number): KbNode[] {
  const random = prng(7);
  const nodes: KbNode[] = bundledSeed(AT);
  const tag = (id: string, text: string, fields: string[] = []): KbNode => ({
    id,
    text,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      ...(fields.length > 0
        ? { "sys.f.fields": fields.map((v) => ({ t: "ref" as const, v })) }
        : {}),
    },
    children: [],
    createdAt: AT,
    updatedAt: AT,
  });
  const field = (id: string, text: string): KbNode => ({
    id,
    text,
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "sys.field" }] },
    children: [],
    createdAt: AT,
    updatedAt: AT,
  });
  nodes.push(field("gen.status", "status"), field("gen.due", "due"));
  nodes.push(tag("gen.todo", "todo", ["gen.status", "gen.due"]), tag("gen.project", "project"));
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(`gen.n${String(i).padStart(6, "0")}`);
  const children = new Map<string, string[]>();
  for (let i = 1; i < n; i++) {
    const parent = ids[Math.floor(random() * Math.min(i, 2000))] ?? "";
    children.set(parent, [...(children.get(parent) ?? []), ids[i] ?? ""]);
  }
  for (const [i, id] of ids.entries()) {
    const props: KbNode["props"] = {};
    const r = random();
    if (r < 0.1) {
      props[SYSTEM_IDS.typeField] = [{ t: "ref", v: "gen.todo" }];
      props["gen.status"] = [{ t: "str", v: random() < 0.5 ? "doing" : "done" }];
      props["gen.due"] = [
        { t: "str", v: `2026-01-${String(1 + Math.floor(random() * 28)).padStart(2, "0")}` },
      ];
    } else if (r < 0.12) {
      props[SYSTEM_IDS.typeField] = [{ t: "ref", v: "gen.project" }];
    }
    const mention = random() < 0.1 ? ` see [[${ids[Math.floor(random() * n)]}]]` : "";
    nodes.push({
      id,
      text: `node ${i} ${random() < 0.05 ? "kb" : "note"}${mention}`,
      props,
      children: children.get(id) ?? [],
      createdAt: AT,
      updatedAt: AT,
    });
  }
  return nodes;
}

/** The ids a workload names: the todo tag, its status field, a root of the outline and a node to link to. */
interface Anchors {
  readonly todo: string;
  readonly status: string;
  readonly due: string;
  readonly root: string;
  readonly linked: string;
}

function anchorsOf(nodes: readonly KbNode[]): Anchors {
  const named = (text: string, fallback: string) =>
    nodes.find((n) => n.text === text && !n.id.startsWith("sys."))?.id ?? fallback;
  // A content node with children: one the person made, not one the seed did.
  const seeded = new Set(bundledSeed(AT).map((n) => n.id));
  const content = nodes.filter((n) => !seeded.has(n.id) && n.children.length > 0);
  return {
    todo: named("todo", "gen.todo"),
    status: named("status", "gen.status"),
    due: named("due", "gen.due"),
    root: content[0]?.id ?? "gen.n000000",
    linked: content[1]?.id ?? "gen.n000001",
  };
}

/** What a page watches: query nodes, a view's family query, and the builder's rows. */
function workload(a: Anchors): string[] {
  const conditions: Condition[][] = [
    [{ kind: "has-tag", tag: a.todo }],
    [
      { kind: "has-tag", tag: a.todo },
      { kind: "field-is", field: a.status, values: [{ t: "str", v: "doing" }] },
    ],
    [
      { kind: "has-tag", tag: a.todo },
      { kind: "field-unset", field: a.status },
    ],
    [{ kind: "text-contains", text: "kb", exactCase: false }],
    [{ kind: "date-within", field: a.due, direction: "next", days: 7 }],
    [{ kind: "instant-within", attr: "edited", days: 7 }],
    [{ kind: "under", node: a.root, via: { t: "child" }, maxHops: 3 }],
    [{ kind: "links-to", node: a.linked }],
    [{ kind: "child-of", node: a.root }],
  ];
  return [
    `[:find ?id ?text :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :node/id ?id] [?n :node/text ?text]]`,
    `[:find ?id :where [?n :f/sys.f.view ?o] [?o :f/sys.f.view.family ?f] [?f :node/id "sys.view-family.graph.renderer"] [?n :node/id ?id]]`,
    ...conditions.map((c) => printEdn(lowerIr(c))),
  ];
}

/** A seeded edit a person makes: mostly typing, then adding, setting, tagging, moving and deleting. */
function editsOf(start: readonly KbNode[], a: Anchors, count: number): StoreTx[] {
  const random = prng(11);
  const nodes = new Map(start.map((n) => [n.id, n]));
  const content = () => [...nodes.values()].filter((n) => !n.id.startsWith("sys."));
  let pool = content();
  const pick = () => pool[Math.floor(random() * pool.length)] as KbNode;
  const txs: StoreTx[] = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(CLOCK.nowMs + i * 1000).toISOString();
    const r = random();
    let tx: StoreTx;
    const node = pick();
    if (r < 0.6) {
      tx = { upserts: [{ ...node, text: `${node.text}x`, updatedAt: at }], deletes: [] };
    } else if (r < 0.75) {
      const id = `bench.new${i}`;
      const child: KbNode = { id, text: "", props: {}, children: [], createdAt: at, updatedAt: at };
      tx = {
        upserts: [child, { ...node, children: [...node.children, id], updatedAt: at }],
        deletes: [],
      };
    } else if (r < 0.85) {
      const status = random() < 0.5 ? "doing" : "done";
      tx = {
        upserts: [
          {
            ...node,
            props: { ...node.props, [a.status]: [{ t: "str", v: status }] },
            updatedAt: at,
          },
        ],
        deletes: [],
      };
    } else if (r < 0.9) {
      const tagged = (node.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.v === a.todo);
      const props = { ...node.props };
      if (tagged) delete props[SYSTEM_IDS.typeField];
      else props[SYSTEM_IDS.typeField] = [{ t: "ref", v: a.todo }];
      tx = { upserts: [{ ...node, props, updatedAt: at }], deletes: [] };
    } else if (r < 0.95) {
      const parent = [...nodes.values()].find((n) => n.children.includes(node.id));
      const target = pick();
      if (parent === undefined || target.id === node.id || target.id === parent.id) {
        tx = { upserts: [{ ...node, text: `${node.text}y`, updatedAt: at }], deletes: [] };
      } else {
        tx = {
          upserts: [
            { ...parent, children: parent.children.filter((c) => c !== node.id), updatedAt: at },
            { ...target, children: [...target.children, node.id], updatedAt: at },
          ],
          deletes: [],
        };
      }
    } else {
      const leaf = pool.find((n) => n.children.length === 0 && !n.id.startsWith("sys.")) ?? node;
      const parent = [...nodes.values()].find((n) => n.children.includes(leaf.id));
      tx = {
        upserts: parent
          ? [{ ...parent, children: parent.children.filter((c) => c !== leaf.id), updatedAt: at }]
          : [],
        deletes: [leaf.id],
      };
    }
    for (const id of tx.deletes) nodes.delete(id);
    for (const n of tx.upserts) nodes.set(n.id, n);
    if (tx.deletes.length > 0 || r >= 0.6) pool = content();
    else for (const n of tx.upserts) pool[pool.findIndex((p) => p.id === n.id)] = n;
    txs.push(tx);
  }
  return txs;
}

/** How often each watched query ran again, per edit, on the last graph replayed: what is left to run. */
const perQuery = new Map<string, number>();

function replay(name: string, nodes: KbNode[]): void {
  const anchors = anchorsOf(nodes);
  const queries = workload(anchors);
  const txs = editsOf(nodes, anchors, EDITS);
  const index = new DatascriptIndex(nodes, { derived: bundledDerived(), clock: () => CLOCK });
  for (const edn of queries) index.answerDatalog(edn);
  const runsBefore = index.runs;
  let asked = 0;
  let answerMs = 0;
  let applyMs = 0;
  for (const tx of txs) {
    const applied = performance.now();
    index.applyTx(tx);
    applyMs += performance.now() - applied;
    const started = performance.now();
    for (const edn of queries) {
      const before = index.runs;
      index.answerDatalog(edn);
      perQuery.set(edn, (perQuery.get(edn) ?? 0) + (index.runs - before) / txs.length);
    }
    answerMs += performance.now() - started;
    asked += queries.length;
  }
  const ran = index.runs - runsBefore;
  if (name !== "generated") perQuery.clear();
  writeOut(
    `| ${name} | ${nodes.length} | ${queries.length} | ${txs.length} | ${(asked / txs.length).toFixed(2)} | ${(ran / txs.length).toFixed(2)} | ${(answerMs / txs.length).toFixed(2)} | ${(applyMs / txs.length).toFixed(2)} |`,
  );
}

if (benchmarkEnabled)
  describe("query re-runs per edit", () => {
    test("replay", () => {
      writeOut(
        "| graph | nodes | watched | edits | asked/edit | ran/edit | answer ms/edit | apply ms/edit |",
      );
      writeOut("|---|---:|---:|---:|---:|---:|---:|---:|");
      const extra = process.env["KB_BENCH_STORE"];
      if (extra !== undefined) replay(extra.split("/").at(-3) ?? extra, readStore(extra));
      replay("kb", readStore(join(import.meta.dir, "../../../../.kb/nodes.jsonl")));
      replay(`generated`, generated(GENERATED));
      writeOut("");
      writeOut("| query (generated graph) | ran/edit |");
      writeOut("|---|---:|");
      for (const [edn, rate] of perQuery) {
        writeOut(`| \`${edn.replaceAll(/\s+/g, " ").slice(0, 110)}\` | ${rate.toFixed(2)} |`);
      }
    }, 600_000);
  });
