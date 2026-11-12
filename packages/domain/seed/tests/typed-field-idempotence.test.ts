import { expect, test } from "bun:test";
import { ensureSystemSeed } from "../src/seed.ts";
import { bundledFold } from "@kb/bundled";

test("ensureSystemSeed is idempotent over typed-field nodes", () => {
  const first = ensureSystemSeed([], bundledFold());
  expect(first.seeded).toBe(true);
  const again = ensureSystemSeed(first.nodes, bundledFold());
  expect(again.seeded).toBe(false);
  expect(again.nodes.length).toBe(first.nodes.length);
});
