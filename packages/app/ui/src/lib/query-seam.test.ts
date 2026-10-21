import { describe, expect, it } from "vitest";
import { normalizeEdnQuery } from "@kb/query"; // GAP [[01M1RXNP3EMV1ES85BVE9CXMYE]]
import { fixtureGraph } from "@/api/fixture-graph";
import { DatascriptIndex, derivedWith, inThreadTransport, ReplicaQueries } from "@kb/ui-sdk";

/**
 * The page's one datalog seam is an `EdnRunner`: the helpers take one, and
 * the replica's answers (`QueryAnswers`) are what hands the page its runner.
 */
describe("client datalog execution", () => {
  const qdb = new DatascriptIndex(fixtureGraph.nodes, { derived: derivedWith({}) });
  const queries = new ReplicaQueries(inThreadTransport(qdb), () => qdb.generation);
  /** The runner as the page reads it: over the answers, once they are in. */
  const run = (edn: string) => queries.settle((r) => r(edn));

  it("normalizes keywords but not directives", () => {
    expect(normalizeEdnQuery("[:find ?id :where [?n :node/id ?id]]")).toBe(
      '[:find ?id :where [?n ":node/id" ?id]]',
    );
  });

  it("runs a query and returns tuple rows", async () => {
    const rows = await run("[:find ?id :where [?n :node/id ?id]]");
    const ids = rows.map((r) => r[0]);
    expect(ids).toContain("n.root-a");
    expect(ids).toContain("sys.tag");
  });

  it("revives entity ids in results to node ids", async () => {
    const rows = await run('[:find ?n :where [?n :node/text "Ship kb ui shell"]]');
    expect(rows).toEqual([["n.root-a"]]);
  });

  it("joins through ref props (same dialect as the server)", async () => {
    const rows = await run(
      '[:find ?id :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :node/id ?id]]',
    );
    expect(rows.map((r) => r[0])).toContain("n.root-a");
  });

  it("reads as no rows until answered, never blocking", () => {
    const fresh = new ReplicaQueries(inThreadTransport(qdb), () => qdb.generation);
    expect(fresh.runner()("[:find ?id :where [?n :node/id ?id]]")).toEqual([]);
  });

  it("throws on malformed queries (caller shows the error)", async () => {
    await expect(run("[:find ?x :where")).rejects.toThrow();
  });
});
