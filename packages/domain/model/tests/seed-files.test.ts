/**
 * A source files its own seed nodes under a list node (`SeedSource.files`):
 * a pin among the Pinned, a view among the Views, or a node only it reads
 * under its own node, so the outline's home does not show it. A node it
 * does not seed, or a list no source declares, is a bundling defect.
 */
import { describe, expect, test } from "bun:test";
import { extensionNodeId, SYSTEM_IDS, type KbNode, type NodeId } from "../src/model.ts";
import { present } from "../src/present.ts";
import { foldSeed, type SeedSource } from "../src/seed-fold.ts";

const AT = "2026-11-09T00:00:00.000Z";
const node = (id: NodeId, text: string): KbNode => ({
  id,
  text,
  props: {},
  children: [],
  createdAt: AT,
  updatedAt: AT,
});

const CORE: SeedSource = {
  name: "core",
  label: "Core",
  seed: () => [node(SYSTEM_IDS.extensionsRoot, "extensions"), node(SYSTEM_IDS.viewsRoot, "views")],
};

const probe = (files: SeedSource["files"]): SeedSource => ({
  name: "probe",
  label: "Probe",
  seed: () => [node("probe.q.one", "one"), node("probe.q.two", "two")],
  files,
});

describe("a source's files", () => {
  test("may name its own node, which keeps its place among the extensions", () => {
    const own = extensionNodeId("probe");
    const { nodes, owners } = foldSeed(
      [CORE, probe({ [own]: ["probe.q.one", "probe.q.two"] })],
      AT,
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(present(byId.get(own), "its own node").children).toEqual(["probe.q.one", "probe.q.two"]);
    expect(present(byId.get(SYSTEM_IDS.extensionsRoot), "the list").children).toContain(own);
    expect(nodes.filter((n) => n.id === own)).toHaveLength(1);
    expect(owners.get("probe.q.one")).toBe("probe");
  });

  test("refuse a node it does not seed, or a list no source declares", () => {
    expect(() => foldSeed([CORE, probe({ [SYSTEM_IDS.viewsRoot]: ["core.x"] })], AT)).toThrow(
      /files core.x, which it does not seed/,
    );
    expect(() => foldSeed([CORE, probe({ "sys.queries": ["probe.q.one"] })], AT)).toThrow(
      /no seed source declares sys.queries/,
    );
  });
});
