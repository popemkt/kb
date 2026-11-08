import { expect, test } from "bun:test";
import { Effect } from "effect";
import { checkedExtensionTree, MANIFEST_SUFFIX, parseSource } from "../src/index.ts";
test("source grammar rejects traversal and abbreviations", () => {
  expect(parseSource("github:owner/repo/path@main")).toEqual({
    repo: "owner/repo",
    path: "path",
    ref: "main",
  });
  expect(() => parseSource("github:owner/repo/../path@main")).toThrow();
  expect(() => parseSource("github:owner/repo@123abcd")).toThrow();
});

const file = (path: string) => ({ path, mode: "100644", bytes: new TextEncoder().encode("{}") });

test("an extension's tree carries its manifest, and leaves another file behind", async () => {
  const source = await Effect.runPromise(
    checkedExtensionTree([
      file("hello.ts"),
      file(`hello${MANIFEST_SUFFIX}`),
      file(`other${MANIFEST_SUFFIX}`),
    ]),
  );
  expect(source.files.map(({ path }) => path)).toEqual(["hello.manifest.json", "hello.ts"]);
  expect(source.ignored).toEqual(["other.manifest.json"]);
});
