import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { canonicalJsonl, fieldTypeValue } from "@kb/model";
import {
  kbCtxLayer,
  type EffectStore,
  type KbContext,
  type KbTxLog,
  type TxRecord,
  type TxTail,
} from "@kb/contracts";
import type { KbNode, KbTx, StoreTx } from "@kb/model";
import { checkAuditEffect, type Finding } from "../src/index.ts";
import { buildCheckModel } from "../src/model.ts";
import { checkGapsEffect } from "../src/gaps.ts";
import { enforcementSyncs } from "../src/sync.ts";

const ROOT = "/repo";
const AT = "2026-09-06T00:00:00.000Z";

function node(id: string, text: string, props: KbNode["props"] = {}): KbNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}

function typed(id: string, text: string, type: string, props: KbNode["props"] = {}): KbNode {
  return node(id, text, { ...props, "sys.f.type": [{ t: "ref", v: type }] });
}

/** A field that holds refs, as the repo graph declares these. */
function refField(id: string, text: string): KbNode {
  return typed(id, text, "sys.field", { "sys.f.fieldType": [fieldTypeValue("ref")] });
}

function applyTx(nodes: readonly KbNode[], tx: StoreTx): KbNode[] {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  for (const id of tx.deletes) byId.delete(id);
  for (const entry of tx.upserts) byId.set(entry.id, entry);
  return [...byId.values()].toSorted((a, b) => a.id.localeCompare(b.id));
}

/**
 * The fake store's transaction tail, and a log over it.
 *
 * Hand-rolled rather than `@kb/tx-log`'s pair: this is an `extension` package,
 * which may not reach infrastructure, and the fixture's store is in a closure
 * anyway. Small enough that the alternative — widening the import matrix for a
 * test double — would cost more than it saves.
 */
class FixtureTail implements TxTail {
  private readonly recorded: KbTx[] = [];

  head(): number {
    return this.recorded.at(-1)?.rev ?? 0;
  }

  isCurrent(): boolean {
    return true;
  }

  entries(): KbTx[] {
    return [...this.recorded];
  }

  append(ops: StoreTx, record: TxRecord): KbTx {
    const rev = this.head() + 1;
    const tx: KbTx = {
      rev,
      ops,
      at: record.at,
      ...(record.origin === undefined ? {} : { origin: record.origin }),
    };
    this.recorded.push(tx);
    return tx;
  }

  adopt(): void {
    /* Migration is not a thing a fixture store does. */
  }
}

class FixtureLog implements KbTxLog {
  private readonly tail: FixtureTail;
  private rev = 0;

  constructor(tail: FixtureTail) {
    this.tail = tail;
  }

  get head(): number {
    return this.rev;
  }

  refresh(): KbTx[] {
    const caught = this.tail.entries().filter((tx) => tx.rev > this.rev);
    this.rev = this.tail.head();
    return caught;
  }

  append(ops: StoreTx, at: string, origin?: string): KbTx {
    const tx = this.tail.append(ops, origin === undefined ? { at } : { at, origin });
    this.rev = tx.rev;
    return tx;
  }

  since(rev: number): KbTx[] | "snapshot-required" {
    return rev > this.rev ? "snapshot-required" : this.tail.entries().filter((tx) => tx.rev > rev);
  }

  subscribe(): () => void {
    return () => undefined;
  }
}

function fixtureContext(initial: readonly KbNode[]) {
  const tail = new FixtureTail();
  let stored = [...initial];
  let indexed = [...initial];
  let generation = 0;
  let revision = 0;
  const store: EffectStore = {
    path: "/memory/nodes.jsonl",
    changes: Stream.never,
    loadEffect: Effect.sync(() => [...stored]),
    fingerprint: Effect.sync(() => `revision:${revision}`),
    txTail: tail,
    commitEffect: (tx) =>
      Effect.sync(() => {
        const base = `revision:${revision}`;
        stored = applyTx(stored, tx);
        revision += 1;
        return { base, fingerprint: `revision:${revision}`, tx };
      }),
  };
  const index = {
    get generation() {
      return generation;
    },
    rebuild(nodes: ReadonlyArray<KbNode>) {
      indexed = [...nodes];
      generation += 1;
    },
    applyTx(tx: StoreTx) {
      indexed = applyTx(indexed, tx);
      generation += 1;
    },
    run() {
      return [];
    },
    runDatalog() {
      return [];
    },
    pull() {
      return undefined;
    },
    getNode(id: string) {
      return indexed.find((entry) => entry.id === id);
    },
    referencesOf() {
      return new Set<string>();
    },
    allNodes() {
      return indexed;
    },
    storedNodes() {
      return [...indexed];
    },
    search(text: string, limit = Number.POSITIVE_INFINITY) {
      const needle = text.toLowerCase();
      return indexed.filter((entry) => entry.text.toLowerCase().includes(needle)).slice(0, limit);
    },
    withVirtual() {
      generation += 1;
    },
  };
  const log = new FixtureLog(tail);
  const ctx: KbContext = {
    root: ROOT,
    store,
    index,
    log,
    get nodes() {
      return index.storedNodes();
    },
  };
  return { ctx, log };
}

function matchGlob(path: string, pattern: string): boolean {
  if (!pattern.includes("*")) return path === pattern;
  const [prefix = "", suffix = ""] = pattern.split("*");
  return path.startsWith(prefix) && path.endsWith(suffix);
}

function relativePath(path: string): string {
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}

function fileInfo(content: string): FileSystem.File.Info {
  return {
    type: "File",
    mtime: Option.none(),
    atime: Option.none(),
    birthtime: Option.none(),
    dev: 0,
    ino: Option.none(),
    mode: 0o644,
    nlink: Option.none(),
    uid: Option.none(),
    gid: Option.none(),
    rdev: Option.none(),
    size: FileSystem.Size(content.length),
    blksize: Option.none(),
    blocks: Option.none(),
  };
}

function fileLayer(files: ReadonlyMap<string, string>): Layer.Layer<FileSystem.FileSystem> {
  return FileSystem.layerNoop({
    exists: (path) => Effect.succeed(files.has(relativePath(path))),
    stat: (path) => Effect.succeed(fileInfo(files.get(relativePath(path)) ?? "")),
    glob: (pattern) => Effect.succeed([...files.keys()].filter((path) => matchGlob(path, pattern))),
    readFileString: (path) => Effect.succeed(files.get(relativePath(path)) ?? ""),
  });
}

interface Fixture {
  readonly nodes: KbNode[];
  readonly files: Map<string, string>;
}

function fixture(): Fixture {
  const nodes = [
    typed("tag.rule", "rule", "sys.tag"),
    typed("tag.check", "check", "sys.tag"),
    typed("f.home", "home", "sys.field"),
    // Enforcement levels are the field's children — the option set shape.
    // No `#enforcement-level` / `#check-surface` supertag exists to mark them.
    { ...refField("f.enforcement", "enforcement"), children: ["v.prose", "v.harness"] },
    typed("f.gate", "gate", "sys.field"),
    refField("f.check", "check"),
    refField("f.surface", "surface"),
    typed("f.evidence", "evidence", "sys.field"),
    typed("f.invocation", "invocation", "sys.field"),
    typed("f.blocking", "blocking", "sys.field", {
      "sys.f.fieldType": [fieldTypeValue("checkbox")],
    }),
    node("v.prose", "prose"),
    node("v.harness", "harness"),
    node("check.harness", "harness-check", {
      "sys.f.type": [{ t: "ref", v: "tag.check" }],
      "f.surface": [{ t: "ref", v: "v.harness" }],
      "f.evidence": [{ t: "str", v: "harness/tests/check.test.ts" }],
      "f.invocation": [{ t: "str", v: "bun run harness" }],
      "f.blocking": [{ t: "bool", v: true }],
    }),
    node("rule.one", "One rule", {
      "sys.f.type": [{ t: "ref", v: "tag.rule" }],
      "f.home": [{ t: "str", v: "AGENTS.md#one-rule" }],
      "f.enforcement": [{ t: "ref", v: "v.harness" }],
      "f.check": [{ t: "ref", v: "check.harness" }],
    }),
  ];
  return {
    nodes,
    files: new Map([
      ["AGENTS.md", "# One rule\n"],
      ["harness/tests/check.test.ts", "test"],
      ["package.json", '"verify": "bun run harness"'],
    ]),
  };
}

function updateNode(nodes: KbNode[], id: string, update: (node: KbNode) => KbNode): void {
  const index = nodes.findIndex((entry) => entry.id === id);
  const current = nodes[index];
  if (current !== undefined) nodes[index] = update(current);
}

function audit(input: Fixture): Promise<readonly Finding[]> {
  const { ctx } = fixtureContext(input.nodes);
  return Effect.runPromise(
    checkAuditEffect({}).pipe(
      Effect.provide(Layer.mergeAll(kbCtxLayer(ctx), fileLayer(input.files))),
    ),
  ).then((output) => output.findings);
}

describe("ext.check.audit", () => {
  test("reports check-missing", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: {
        ...rule.props,
        "f.check": [{ t: "ref", v: "check.absent" }],
        "f.enforcement": [{ t: "ref", v: "v.prose" }],
      },
    }));
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("check-missing");
      return undefined;
    });
  });

  test("reports evidence-missing", () => {
    const input = fixture();
    input.files.delete("harness/tests/check.test.ts");
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("evidence-missing");
      return undefined;
    });
  });

  test("reports invocation-unwired", () => {
    const input = fixture();
    input.files.set("package.json", '"verify": "bun run lint"');
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("invocation-unwired");
      return undefined;
    });
  });

  test("reports enforcement-stale", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: { ...rule.props, "f.enforcement": [{ t: "ref", v: "v.prose" }] },
    }));
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("enforcement-stale");
      return undefined;
    });
  });

  test("reports gate-and-check", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: { ...rule.props, "f.gate": [{ t: "str", v: "future gate" }] },
    }));
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("gate-and-check");
      return undefined;
    });
  });

  test("reports home-broken", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: { ...rule.props, "f.home": [{ t: "str", v: "AGENTS.md#missing" }] },
    }));
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("home-broken");
      return undefined;
    });
  });

  test("an https home in another repository resolves by its form alone", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: {
        ...rule.props,
        "f.home": [{ t: "str", v: "https://github.com/popemkt/kb/blob/main/AGENTS.md#one-rule" }],
      },
    }));
    return audit(input).then((findings) => {
      expect(findings).toEqual([]);
      return undefined;
    });
  });

  test("a URL home that is not https with a host is home-broken", () => {
    const homes = ["http://example.com/AGENTS.md", "https://", "mailto:someone@example.com"];
    return Promise.all(
      homes.map((home) => {
        const input = fixture();
        updateNode(input.nodes, "rule.one", (rule) => ({
          ...rule,
          props: { ...rule.props, "f.home": [{ t: "str", v: home }] },
        }));
        return audit(input).then((findings) => findings.map((finding) => finding.kind));
      }),
    ).then((kinds) => {
      expect(kinds).toEqual([["home-broken"], ["home-broken"], ["home-broken"]]);
      return undefined;
    });
  });

  test("sync followed by audit is clean", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: { ...rule.props, "f.enforcement": [{ t: "ref", v: "v.prose" }] },
    }));
    // What sync writes goes through the host's `GraphWrites`; the decision
    // is this family's, so it is checked here on the graph it would leave.
    const upserts = enforcementSyncs(buildCheckModel(input.nodes), AT);
    expect(upserts.map((entry) => entry.id)).toEqual(["rule.one"]);
    const synced = { ...input, nodes: applyTx(input.nodes, { upserts, deletes: [] }) };
    return audit(synced).then((findings) => {
      expect(findings).toEqual([]);
      return undefined;
    });
  });

  test("an enforcement level is a CHILD of the field — a loose node is not one", () => {
    // The option set is the parenting, not a supertag. A node named "harness"
    // that is not the field's child cannot be the value sync writes back, so
    // sync must find nothing rather than pick a lookalike out of the graph.
    const input = fixture();
    updateNode(input.nodes, "f.enforcement", (field) => ({ ...field, children: ["v.prose"] }));
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: { ...rule.props, "f.enforcement": [{ t: "ref", v: "v.prose" }] },
    }));
    expect(enforcementSyncs(buildCheckModel(input.nodes), AT)).toEqual([]);
  });

  test("audit is pure", () => {
    const input = fixture();
    const { ctx, log } = fixtureContext(input.nodes);
    const before = canonicalJsonl(ctx.nodes);
    return Effect.runPromise(
      checkAuditEffect({}).pipe(
        Effect.provide(Layer.mergeAll(kbCtxLayer(ctx), fileLayer(input.files))),
      ),
    ).then(() => {
      expect(canonicalJsonl(ctx.nodes)).toBe(before);
      expect(log.head).toBe(0);
      return undefined;
    });
  });
});

// Built, not written out: this file is scanned too, and a literal marker
// here would name these fixture ids in the real store.
const mark = (id: string) => ["GAP ", "[[", id, "]]"].join("");

describe("ext.check.gaps", () => {
  const gapNodes = [
    typed("tag.gap", "gap", "sys.tag"),
    typed("f.status", "status", "sys.field"),
    typed("gap.open", "GAP: still deferred", "tag.gap", { "f.status": [{ t: "str", v: "todo" }] }),
    typed("gap.done", "GAP: closed", "tag.gap", { "f.status": [{ t: "str", v: "done" }] }),
    node("note", "a plain node"),
  ];

  function gaps(files: Record<string, string>, listed: readonly string[] = Object.keys(files)) {
    const { ctx } = fixtureContext(gapNodes);
    return Effect.runPromise(
      checkGapsEffect({ files: [...listed] }).pipe(
        Effect.provide(Layer.mergeAll(kbCtxLayer(ctx), fileLayer(new Map(Object.entries(files))))),
      ),
    );
  }

  test("a marker naming an open #gap is clean, and the scan counts what it read", async () => {
    const out = await gaps({ "a.ts": `// ${mark("gap.open")}\nconst x = 1;\n`, "b.nix": "{ }\n" });
    expect(out).toEqual({ clean: true, scanned: 2, markers: 1, findings: [] });
  });

  test("a missing, untagged or closed gap is a finding at its line", async () => {
    const out = await gaps({
      "a.ts": `x\n// ${mark("gap.absent")}\n`,
      "b.sh": `# ${mark("note")}\n`,
      "c.css": `/* ${mark("gap.done")} */\n`,
    });
    expect(out.clean).toBe(false);
    expect(out.findings.map((f) => [f.kind, f.file, f.line, f.id])).toEqual([
      ["gap-missing", "a.ts", 2, "gap.absent"],
      ["gap-untagged", "b.sh", 1, "note"],
      ["gap-closed", "c.css", 1, "gap.done"],
    ]);
  });

  test("a listed file that is not there is a finding, never a skip", async () => {
    const out = await gaps({ "a.ts": "" }, ["a.ts", "gone.ts", "../outside.ts"]);
    expect(out.findings.map((f) => [f.kind, f.file])).toEqual([
      ["file-unreadable", "gone.ts"],
      ["file-unreadable", "../outside.ts"],
    ]);
  });
});
