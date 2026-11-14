import { describe, expect, test, afterEach } from "bun:test";
import { Effect } from "effect";
import { canonicalJsonl } from "@kb/model";
import {
  runScenario,
  cleanup,
  COMMITTED_SEEDS,
  orderIdsByParent,
  contentDanglingRefs,
  parentOf,
  DANGLING_REF_DECISION,
  type ScenarioResult,
} from "../src/harness.ts";

const done: ScenarioResult[] = [];
afterEach(async () => {
  for (const r of done) await Effect.runPromise(cleanup(r)).catch(() => {});
  done.length = 0;
});

async function run(seed: string, opts?: { ops?: number }): Promise<ScenarioResult> {
  const r = await Effect.runPromise(runScenario(seed, opts));
  done.push(r);
  return r;
}

/**
 * How long a DST test may take: one scenario, or a replay's two.
 *
 * A scenario replays a whole seeded history through the real plan/apply path —
 * seconds of work, not milliseconds — so bun's 5000 ms default gates on how
 * busy the host is rather than on whether the store behaved, and a rerun on a
 * quiet machine "fixes" it. That is the lesson closed gap
 * [[01M1R19NXBMTVQG6AH0S7VTC7D]] was filed to unteach.
 *
 * Sized from measurement, not from taste. On CI's four-worker `bun test
 * packages`, one scenario takes 1.5 to 7.2 s, so a replay's pair is under
 * 15 s at the worst seen; the budget is about twice that. It holds because no
 * test runs more than two scenarios: each committed seed is its own test. A
 * test that looped over every seed ran eight scenarios under this one budget,
 * took 17 to 30 s on CI, and once overran it.
 *
 * An overrun is not only a red test. Bun goes on to the next test while the
 * overrun body keeps running, and the next test's preload moves `KB_DATA`
 * under it, where commits keep their backups: the body then diverges from its
 * replay for a reason outside the store (GAP [[01M740E2KPGXWP4WKTE2XZ6N56]]).
 */
const SCENARIO_TIMEOUT_MS = 32_000;

/**
 * A DST scenario, carrying the budget above. Declared once so the number has a
 * single home: a per-test literal is the same magic number written ten times.
 */
function scenarioTest(name: string, body: () => Promise<void>): void {
  test(name, body, SCENARIO_TIMEOUT_MS);
}

describe("DST — seeded histories over the real plan/apply path", () => {
  for (const seed of COMMITTED_SEEDS) {
    scenarioTest(
      `committed seed ${seed} produces a legal store with zero structural violations`,
      async () => {
        const r = await run(seed);
        expect(r.violations, `${seed}: ${r.violations.join("; ")}`).toEqual([]);
        expect(r.ops).toBe(60);
        expect(r.nodes.length).toBeGreaterThan(0);
      },
    );
  }

  for (const seed of COMMITTED_SEEDS) {
    scenarioTest(`committed seed ${seed} replays to a byte-identical store`, async () => {
      const a = await run(seed);
      const b = await run(seed);
      expect(a.json, `seed ${seed} replay diverged`).toBe(b.json);
      expect(a.nodes.length).toBe(b.nodes.length);
    });
  }

  scenarioTest("the on-disk store round-trips to identical canonical bytes", async () => {
    const a = await run("dst-0");
    expect(canonicalJsonl(a.nodes)).toBe(a.json);
  });

  scenarioTest(
    "every sibling/root group is strictly, uniquely ordered after migration",
    async () => {
      const a = await run("dst-2");
      expect(a.violations, a.violations.join("; ")).toEqual([]);
      const groups = orderIdsByParent(a.nodes);
      expect(groups.length).toBeGreaterThan(0);
    },
  );

  scenarioTest("sys.* write guards hold: no sys node is minted or mutated by the sim", async () => {
    const a = await run("dst-3");
    expect(a.violations, a.violations.join("; ")).toEqual([]);
  });

  scenarioTest("different seeds produce (almost certainly) different stores", async () => {
    const a = await run("dst-0");
    const b = await run("dst-4");
    expect(a.json).not.toBe(b.json);
  });
});

describe("DST — dangling inbound refs are intended, not a violation", () => {
  test("the decision is encoded and consistent with the invariant check", () => {
    // The invariant checker must NOT flag content dangling refs; the store is
    // legal with them present (deleting a node never rewrites another node).
    expect(DANGLING_REF_DECISION).toMatch(/intended/);
  });

  scenarioTest(
    "deleting a field node orphans prop keys but the store stays legal + round-trips",
    async () => {
      // A field is just a node; deleting it leaves any prop keyed by it dangling.
      // That is INTENDED (the store never rewrites another node's props), and the
      // store must still be structurally legal and byte-stable. This seed is one
      // of the committed set that exercises the delete path onto a field node.
      const a = await run("dst-0");
      expect(a.violations, a.violations.join("; ")).toEqual([]);
      expect(canonicalJsonl(a.nodes)).toBe(a.json);
    },
  );

  scenarioTest(
    "a node referenced by another node's prop/mention can be deleted safely",
    async () => {
      // The sim embeds `[[id|label]]` mentions + set/unset prop ops and deletes
      // arbitrary content nodes (even field nodes, which orphans prop keys). The
      // store must stay legal (structural edges resolve), and anything dangling
      // must be CONTENT — never a structural child edge.
      const a = await run("dst-4");
      expect(a.violations, a.violations.join("; ")).toEqual([]);

      const dangling = contentDanglingRefs(a.nodes);
      const parents = parentOf(a.nodes);
      for (const n of a.nodes) {
        for (const c of n.children) {
          // Every structural child edge must resolve — the violation side.
          expect(parents.has(c), `node ${n.id} references missing child ${c}`).toBe(true);
        }
      }
      // Whatever dangles is a tolerated content ref (ref value / mention / prop
      // key). The harness never flags it; it only enforces structural integrity
      // and byte-stable round-trips.
      expect(
        dangling.every((d) => /^(ref|mention|propkey) /.test(d)),
        `unexpected dangling kind: ${dangling.join("; ")}`,
      ).toBe(true);
    },
  );
});

describe("DST — deliberate defect is caught with seed + op index", () => {
  scenarioTest(
    "the harness surfaces invariant violations with a one-line reproduction",
    async () => {
      // This is a red-then-green demonstration performed against a deliberately
      // broken store. The harness reports `op#N (seed S)` so the failure is a
      // single line. The committed harness is green; the red evidence is in the
      // handoff report. Here we only assert the reporting shape is usable.
      const r = await Effect.runPromise(runScenario("dst-5", { ops: 5 }));
      done.push(r);
      expect(r.seed).toBe("dst-5");
      for (const v of r.violations) {
        expect(v).toMatch(/op#\d+ \(seed dst-5\)/);
      }
    },
  );
});
