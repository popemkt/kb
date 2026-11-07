import { expect, test } from "bun:test";
import { parseSource } from "../src/index.ts";
test("source grammar rejects traversal and abbreviations", () => {
  expect(parseSource("github:owner/repo/path@main")).toEqual({
    repo: "owner/repo",
    path: "path",
    ref: "main",
  });
  expect(() => parseSource("github:owner/repo/../path@main")).toThrow();
  expect(() => parseSource("github:owner/repo@123abcd")).toThrow();
});
