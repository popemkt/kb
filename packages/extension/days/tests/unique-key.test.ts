import { expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import { DAYS_IDS } from "../src/ids";
import { duplicateKeyOf } from "../src/unique-key";

const at = "2026-11-10T00:00:00.000Z";
function node(id: string, key?: string): KbNode {
  return {
    id,
    text: id,
    props: key === undefined ? {} : { [DAYS_IDS.keyField]: [{ t: "str", v: key }] },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

test("a second node with a held key is refused", () => {
  const before = [node("a", "2026-11-10")];
  expect(duplicateKeyOf([{ before: undefined, after: node("b", "2026-11-10") }], before)).toEqual({
    key: "2026-11-10",
    ids: ["a", "b"],
  });
});

test("one commit that keys two nodes alike is refused", () => {
  const writes = [
    { before: undefined, after: node("a", "2026-W46") },
    { before: undefined, after: node("b", "2026-W46") },
  ];
  expect(duplicateKeyOf(writes, [])?.ids).toEqual(["a", "b"]);
});

test("rewriting a day's other fields, renaming or moving it, is never looked at", () => {
  const day = node("a", "2026-11-10");
  const renamed = { ...day, text: "my birthday" };
  expect(
    duplicateKeyOf([{ before: day, after: renamed }], [day, node("x", "2026-11-10")]),
  ).toBeNull();
});

test("a key may move from one node to another in one commit", () => {
  const a = node("a", "2026-11-10");
  const writes = [
    { before: a, after: node("a") },
    { before: undefined, after: node("b", "2026-11-10") },
  ];
  expect(duplicateKeyOf(writes, [a])).toBeNull();
});

test("a deleted holder frees its key", () => {
  const a = node("a", "2026-11-10");
  const writes = [
    { before: a, after: undefined },
    { before: undefined, after: node("b", "2026-11-10") },
  ];
  expect(duplicateKeyOf(writes, [a])).toBeNull();
});
