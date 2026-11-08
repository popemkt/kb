import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sourceFilesUnder } from "../src/import-graph.ts";
import { PACKAGES_ROOT } from "../src/workspace.ts";

test("every point constructor supplies a specification", () => {
  const missing = [...sourceFilesUnder(PACKAGES_ROOT)].flatMap((file) => {
    if (file.includes("/tests/") || /\.test\.tsx?$/.test(file)) return [];
    const source = readFileSync(file, "utf8");
    return /Point<[^;]+?>\(\)\(\s*["'][^"']+["']\s*\)/.test(source) ? [file] : [];
  });
  expect(missing).toEqual([]);
});
