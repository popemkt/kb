/**
 * `#approval-policy` nodes as the resolver reads them, and the defaults the
 * seed writes (DESIGN.md → Action registry → Approval).
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, viewOptionId, type KbNode } from "@kb/model";
import { bundledSeed } from "@kb/bundled";
import {
  ACTOR_OPTION_IDS,
  DECISION_OPTION_IDS,
  GOVERNANCE_IDS,
  approvalPoliciesOf,
  approvalPolicyNode,
} from "../src/index.ts";

const node = (id: string, props: KbNode["props"] = {}): KbNode => ({
  id,
  text: id,
  props,
  children: [],
  createdAt: "",
  updatedAt: "",
});

describe("approval policies", () => {
  test("a policy is read from its tag and fields; an absent actor is every actor", () => {
    const agent = approvalPolicyNode(node("p.agent"), {
      match: "node.delete",
      actor: "agent",
      decision: "ask",
    });
    const anyone = approvalPolicyNode(node("p.anyone"), {
      match: " ext.* ",
      actor: null,
      decision: "deny",
    });
    expect(approvalPoliciesOf([agent, anyone])).toEqual([
      { id: "p.agent", match: "node.delete", actor: "agent", decision: "ask" },
      { id: "p.anyone", match: "ext.*", actor: null, decision: "deny" },
    ]);
  });

  test("a half-written policy decides nothing, and an untagged node is no policy", () => {
    const tag = {
      [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: GOVERNANCE_IDS.policyTag }],
    };
    const decision = {
      [GOVERNANCE_IDS.decisionField]: [{ t: "ref" as const, v: DECISION_OPTION_IDS.deny }],
    };
    const match = { [GOVERNANCE_IDS.matchField]: [{ t: "str" as const, v: "node.add" }] };
    const nodes = [
      node("no.match", { ...tag, ...decision }),
      node("no.decision", { ...tag, ...match }),
      node("bad.actor", {
        ...tag,
        ...match,
        ...decision,
        [GOVERNANCE_IDS.actorField]: [{ t: "ref", v: "n.someone" }],
      }),
      node("untagged", { ...match, ...decision }),
    ];
    expect(approvalPoliciesOf(nodes)).toEqual([]);
  });

  test("the seed tags its vocabulary as options and, while policies are deferred, holds no policy", () => {
    const seed = bundledSeed();
    const byId = new Map(seed.map((seeded) => [seeded.id, seeded]));
    expect(byId.get(GOVERNANCE_IDS.actorField)?.children).toEqual(Object.values(ACTOR_OPTION_IDS));
    expect(byId.get(GOVERNANCE_IDS.decisionField)?.children).toEqual(
      Object.values(DECISION_OPTION_IDS),
    );
    // GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]
    expect(approvalPoliciesOf(seed)).toEqual([]);
    expect(byId.get(GOVERNANCE_IDS.policies)?.children).toEqual([]);
  });

  test("the policies are managed in a table view of that query, pinned in the sidebar", () => {
    const byId = new Map(bundledSeed().map((seeded) => [seeded.id, seeded]));
    const host = byId.get(GOVERNANCE_IDS.policies);
    expect(host?.props[SYSTEM_IDS.viewsField]).toEqual([
      { t: "ref", v: GOVERNANCE_IDS.policiesView },
    ]);
    const view = byId.get(GOVERNANCE_IDS.policiesView);
    expect(view?.props[SYSTEM_IDS.viewField]).toEqual([
      { t: "ref", v: viewOptionId("outline.table") },
    ]);
    expect(byId.get(SYSTEM_IDS.viewsList)?.children).toContain(GOVERNANCE_IDS.policiesView);
    expect(byId.get(SYSTEM_IDS.pinnedRoot)?.children).toEqual([GOVERNANCE_IDS.policiesPin]);
    expect(byId.get(GOVERNANCE_IDS.policiesPin)?.props[SYSTEM_IDS.refTargetField]).toEqual([
      { t: "ref", v: GOVERNANCE_IDS.policies },
    ]);
  });
});
