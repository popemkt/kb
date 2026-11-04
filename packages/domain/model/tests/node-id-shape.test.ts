/**
 * The shape of a node id, said once (`model.ts` → `isNodeIdShaped`): what a
 * log may name as a node without reading what anything else says.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { freshId, isNodeIdShaped, SYSTEM_IDS } from "../src/index.ts";

describe("a node id's shape", () => {
  test("is every id kb mints, and every reserved one", () => {
    expect(isNodeIdShaped(Effect.runSync(freshId))).toBe(true);
    for (const id of Object.values(SYSTEM_IDS)) expect(isNodeIdShaped(id)).toBe(true);
  });

  test("is not text, even text that holds an id", () => {
    expect(isNodeIdShaped("private customer information")).toBe(false);
    expect(isNodeIdShaped("sys.f.type and more")).toBe(false);
    expect(isNodeIdShaped(`see [[${Effect.runSync(freshId)}]]`)).toBe(false);
    expect(isNodeIdShaped("01jbz8y3k4m5n6p7q8r9s0t1v2")).toBe(false);
    expect(isNodeIdShaped("")).toBe(false);
  });
});
