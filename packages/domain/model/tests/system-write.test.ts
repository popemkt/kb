/**
 * Which writes to a system node are a person's: its text, a person's ids in
 * its children and its template (every seeded id kept, in order), and the
 * values of fields that configure it (`sys.f.configures`); nothing else of
 * it.
 */
import { describe, expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  extensionNodeId,
  isShipped,
  isWritableField,
  systemWriteRefusal,
  type KbNode,
} from "../src/index.ts";

const AT = "2026-10-17T00:00:00.000Z";
const AGENT = extensionNodeId("agent");

function node(id: string, props: KbNode["props"] = {}, extra: Partial<KbNode> = {}): KbNode {
  return { id, text: id, props, children: [], createdAt: AT, updatedAt: AT, ...extra };
}

const configures = (target: string) => ({
  [SYSTEM_IDS.configuresField]: [{ t: "ref" as const, v: target }],
});
const FIELDS = new Map<string, KbNode>([
  ["sys.f.provider", node("sys.f.provider", configures(AGENT))],
  ["sys.f.elsewhere", node("sys.f.elsewhere", configures(extensionNodeId("graph")))],
  ["sys.f.every", node("sys.f.every", configures(SYSTEM_IDS.extensionsRoot))],
  ["f.minted", node("f.minted", configures(AGENT))],
  ["f.plain", node("f.plain")],
]);
const fieldOf = (id: string) => FIELDS.get(id);
const ref = (v: string) => [{ t: "ref" as const, v }];

describe("a write to a system node", () => {
  const before = node(AGENT);

  test("may set and clear a field that configures that node, stamped anew", () => {
    const set = { ...before, props: { "sys.f.provider": ref("n.p") }, updatedAt: "later" };
    expect(systemWriteRefusal(before, set, fieldOf)).toBeNull();
    expect(systemWriteRefusal(set, before, fieldOf)).toBeNull();
    expect(isWritableField({ id: AGENT }, "sys.f.provider", fieldOf("sys.f.provider"))).toBe(true);
  });

  test("may write a field that configures every extension's node, on each of them", () => {
    for (const id of [AGENT, extensionNodeId("graph")]) {
      expect(isWritableField({ id: id }, "sys.f.every", fieldOf("sys.f.every")), id).toBe(true);
    }
    // The list itself, and any other system node, is no extension's node.
    for (const id of [SYSTEM_IDS.extensionsRoot, SYSTEM_IDS.viewsRoot]) {
      expect(isWritableField({ id: id }, "sys.f.every", fieldOf("sys.f.every")), id).toBe(false);
    }
  });

  test("may not write a field that configures another node, or none", () => {
    for (const field of ["sys.f.elsewhere", "f.plain"]) {
      const next = { ...before, props: { [field]: ref("n.p") } };
      expect(systemWriteRefusal(before, next, fieldOf), field).toEqual({
        rule: "setting",
        id: AGENT,
        field,
      });
      expect(isWritableField({ id: AGENT }, field, fieldOf(field)), field).toBe(false);
    }
  });

  test("may not write a field anyone could add that declares itself a setting", () => {
    // Only a system field is a setting: a field that is not one names what it likes.
    const next = { ...before, props: { "f.minted": ref("n.p") } };
    expect(systemWriteRefusal(before, next, fieldOf)).toEqual({
      rule: "setting",
      id: AGENT,
      field: "f.minted",
    });
    expect(isWritableField({ id: AGENT }, "f.minted", fieldOf("f.minted"))).toBe(false);
  });

  test("takes a new text: a label is the person's", () => {
    expect(systemWriteRefusal(before, { ...before, text: "renamed" }, fieldOf)).toBeNull();
  });

  test("takes a person's child anywhere among the seeded ones, moved or taken back", () => {
    const seeded = { ...before, children: ["sys.a", "sys.b"] };
    for (const children of [
      ["n.mine", "sys.a", "sys.b"],
      ["sys.a", "n.mine", "sys.b", "n.yours"],
      ["sys.a", "sys.b", "n.mine"],
    ]) {
      const next = { ...seeded, children };
      expect(systemWriteRefusal(seeded, next, fieldOf), children.join()).toBeNull();
      expect(systemWriteRefusal(next, seeded, fieldOf), children.join()).toBeNull();
    }
  });

  test("keeps every seeded child, in its order, and takes no system id it did not hold", () => {
    const seeded = { ...before, children: ["sys.a", "n.mine", "sys.b"] };
    for (const children of [
      ["sys.a", "n.mine"],
      ["sys.b", "n.mine", "sys.a"],
      ["sys.a", "n.mine", "sys.b", "sys.c"],
    ]) {
      expect(systemWriteRefusal(seeded, { ...seeded, children }, fieldOf), children.join()).toEqual(
        { rule: "children", id: AGENT },
      );
    }
  });

  test("takes a person's field in its tag's template, and keeps the seeded ones in order", () => {
    const template = (...ids: string[]) => ({
      ...before,
      props: { [SYSTEM_IDS.fieldsField]: ids.map((v) => ({ t: "ref" as const, v })) },
    });
    const seeded = template("sys.f.a", "sys.f.b");
    expect(
      systemWriteRefusal(seeded, template("sys.f.a", "f.mine", "sys.f.b"), fieldOf),
    ).toBeNull();
    expect(
      systemWriteRefusal(template("sys.f.a", "f.mine", "sys.f.b"), seeded, fieldOf),
    ).toBeNull();
    for (const next of [template("sys.f.a"), template("sys.f.b", "sys.f.a")]) {
      expect(systemWriteRefusal(seeded, next, fieldOf)).toEqual({
        rule: "list",
        id: AGENT,
        field: SYSTEM_IDS.fieldsField,
      });
    }
  });

  test("ships the system ids its lists hold, and nothing in a person's node", () => {
    // What the page marks "shipped" is what the commit keeps: the same rule.
    expect(isShipped(before.id, "sys.f.a")).toBe(true);
    expect(isShipped(before.id, "f.mine")).toBe(false);
    expect(isShipped("n.user", "sys.f.a")).toBe(false);
  });

  test("keeps its rank and creation stamp, and is never minted", () => {
    expect(systemWriteRefusal(before, { ...before, order: "a0" }, fieldOf)).toEqual({
      rule: "rank",
      id: AGENT,
    });
    expect(systemWriteRefusal(before, { ...before, createdAt: "later" }, fieldOf)).toEqual({
      rule: "stamp",
      id: AGENT,
    });
    expect(systemWriteRefusal(undefined, before, fieldOf)).toEqual({ rule: "mint", id: AGENT });
  });

  test("is not this rule's business when the node is not a system node", () => {
    const user = node("n.user");
    expect(systemWriteRefusal(undefined, user, fieldOf)).toBeNull();
    expect(systemWriteRefusal(user, { ...user, text: "anything" }, fieldOf)).toBeNull();
    expect(isWritableField({ id: "n.user" }, "f.plain", fieldOf("f.plain"))).toBe(true);
  });
});
