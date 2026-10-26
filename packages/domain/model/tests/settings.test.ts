/**
 * An extension's settings, read: the system fields that configure its node
 * (`settingsOf`, DESIGN.md → Extension families → configuration).
 */
import { describe, expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  extensionNodeId,
  settingsOf,
  systemSeedNodes,
  type KbNode,
} from "../src/index.ts";

const AT = "2026-10-27T00:00:00.000Z";
const CORE = extensionNodeId("core");
const AGENT = extensionNodeId("agent");
const field = { [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.field }] };
const configures = (target: string) => ({
  [SYSTEM_IDS.configuresField]: [{ t: "ref" as const, v: target }],
});

function node(id: string, props: KbNode["props"] = {}, children: string[] = []): KbNode {
  return { id, text: `${id} label`, props, children, createdAt: AT, updatedAt: AT };
}

function read(nodes: readonly KbNode[], nodeId: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return settingsOf(nodes, (id) => byId.get(id), nodeId);
}

describe("settingsOf", () => {
  test("lists the system fields that configure a node, and only those, in id order", () => {
    const nodes = [
      node("sys.f.zeta", { ...field, ...configures(AGENT) }),
      node("sys.f.alpha", { ...field, ...configures(AGENT) }),
      node("sys.f.other", { ...field, ...configures(extensionNodeId("graph")) }),
      node("f.minted", { ...field, ...configures(AGENT) }),
      node("sys.not-a-field", configures(AGENT)),
    ];
    expect(read(nodes, AGENT).map((s) => s.field)).toEqual(["sys.f.alpha", "sys.f.zeta"]);
  });

  test("a field that configures every extension's node is a setting of each, but the switch is not", () => {
    const nodes = [
      node("sys.f.every", { ...field, ...configures(SYSTEM_IDS.extensionsRoot) }),
      node(SYSTEM_IDS.extensionEnabledField, {
        ...field,
        ...configures(SYSTEM_IDS.extensionsRoot),
      }),
    ];
    expect(read(nodes, AGENT).map((s) => s.field)).toEqual(["sys.f.every"]);
    expect(read(nodes, CORE).map((s) => s.field)).toEqual(["sys.f.every"]);
    expect(read(nodes, "n.plain")).toEqual([]);
  });

  test("an option set is listed with its options, in child order, by label", () => {
    const nodes = [
      node("sys.f.pick", { ...field, ...configures(AGENT) }, ["sys.pick.b", "sys.pick.a"]),
      node("sys.pick.a"),
      node("sys.pick.b"),
    ];
    expect(read(nodes, AGENT)).toEqual([
      {
        field: "sys.f.pick",
        label: "sys.f.pick label",
        type: "text",
        cardinality: "many",
        options: [
          { id: "sys.pick.b", label: "sys.pick.b label" },
          { id: "sys.pick.a", label: "sys.pick.a label" },
        ],
      },
    ]);
  });

  test("core's seed: the design system, the backdrop's three and every motion field", () => {
    const settings = read(systemSeedNodes(AT), CORE);
    const ids = settings.map((s) => s.field);
    expect(ids).toContain(SYSTEM_IDS.designSystemField);
    expect(ids).toContain(SYSTEM_IDS.backdropField);
    expect(ids).toContain(SYSTEM_IDS.backdropStrengthField);
    expect(ids).toContain(SYSTEM_IDS.backdropDirectionField);
    expect(ids).not.toContain(SYSTEM_IDS.extensionEnabledField);
    expect(ids.filter((id) => id.startsWith("sys.f.motion.")).length).toBe(14);
    const strength = settings.find((s) => s.field === SYSTEM_IDS.backdropStrengthField);
    expect(strength?.cardinality).toBe("one");
    expect(strength?.options.map((o) => o.label)).toEqual(["subtle", "soft", "vivid"]);
  });
});
