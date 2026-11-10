import { expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  foldSeed,
  systemSeedNodes,
  extensionNodeId,
  roleNodeId,
  roleSelections,
  systemWriteRefusal,
  settingsOf,
} from "../src/index.ts";

const at = "2026-11-09T00:00:00.000Z";

test("the owner seeds an ordinary role node, and its provider is an ordinary writable setting", () => {
  const role = "ui.test-editor";
  const folded = foldSeed(
    [
      { name: "core", label: "Core", seed: systemSeedNodes },
      { name: "owner", label: "Owner", roles: [{ role, label: "Test editor" }] },
    ],
    at,
  );
  const nodes = new Map(folded.nodes.map((node) => [node.id, node]));
  const node = nodes.get(roleNodeId(role));
  if (node === undefined) throw new Error("seeded role");
  expect(folded.owners.get(node.id)).toBe("owner");
  expect(roleSelections([{ role }], (id) => nodes.get(id)).size).toBe(0);
  const chosen = {
    ...node,
    props: {
      ...node.props,
      [SYSTEM_IDS.providerField]: [{ t: "ref" as const, v: extensionNodeId("owner") }],
    },
  };
  expect(systemWriteRefusal(node, chosen, (id) => nodes.get(id))).toBeNull();
  nodes.set(chosen.id, chosen);
  expect(roleSelections([{ role }], (id) => nodes.get(id)).get(role)).toBe("owner");
  expect(
    settingsOf(nodes.values(), (id) => nodes.get(id), chosen.id).some(
      ({ field }) => field === SYSTEM_IDS.providerField,
    ),
  ).toBe(true);
  // Its label is the person's; its kind, like any field that is not a setting, its owner's.
  expect(systemWriteRefusal(chosen, { ...chosen, text: "Mine" }, (id) => nodes.get(id))).toBeNull();
  const untyped = { ...chosen, props: { ...chosen.props, [SYSTEM_IDS.typeField]: [] } };
  expect(systemWriteRefusal(chosen, untyped, (id) => nodes.get(id))).toMatch(/owner's to write/);
});
