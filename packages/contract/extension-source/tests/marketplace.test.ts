import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import {
  MarketplaceIndexSchema,
  checkedTree,
  marketplaceTree,
  marketplaceEntryPin,
  marketplaceName,
} from "../src/index.ts";
const rev = "a".repeat(40);
const index = {
  version: 1,
  name: "sample",
  extensions: [{ name: "hello", source: { path: "extensions/hello" } }],
};
test("one checked index projection and qualified-name grammar", async () => {
  const raw = await Effect.runPromise(
    checkedTree([
      {
        path: "kb-marketplace.json",
        mode: "100644",
        bytes: new TextEncoder().encode(JSON.stringify(index)),
      },
      { path: "README.md", mode: "100644", bytes: new TextEncoder().encode("synthetic") },
    ]),
  );
  const projected = await Effect.runPromise(marketplaceTree(raw));
  expect(projected.source.files.map((file) => file.path)).toEqual(["kb-marketplace.json"]);
  expect(projected.source.ignored).toEqual(["README.md"]);
  expect(
    marketplaceEntryPin({ repo: "owner/repo", path: "catalog", rev }, { path: "extensions/hello" }),
  ).toEqual({ repo: "owner/repo", path: "catalog/extensions/hello", rev });
  expect(
    marketplaceEntryPin(
      { repo: "owner/repo", path: "", rev },
      { github: "other/repo", path: "ext", rev },
    ),
  ).toEqual({ repo: "other/repo", path: "ext", rev });
  expect(marketplaceName("hello@sample")).toEqual({ name: "hello", marketplace: "sample" });
  expect(() => marketplaceName("../hello")).toThrow();
});
for (const source of [
  { github: "other/repo", path: "ext", rev: "main" },
  { github: "other/repo", path: "ext", rev: "a".repeat(7) },
  { path: "../outside" },
  { path: "/outside" },
  { path: "hello", ref: "main" },
  { github: "https://other.example/repo", path: "ext", rev },
])
  test(`index refuses unchecked entry ${JSON.stringify(source)}`, () => {
    expect(
      MarketplaceIndexSchema.safeParse({ ...index, extensions: [{ name: "hello", source }] })
        .success,
    ).toBe(false);
  });
test("duplicate names, unsupported versions and malformed index bytes are refused", async () => {
  expect(
    MarketplaceIndexSchema.safeParse({
      ...index,
      extensions: [...index.extensions, ...index.extensions],
    }).success,
  ).toBe(false);
  expect(MarketplaceIndexSchema.safeParse({ ...index, version: 2 }).success).toBe(false);
  const tree = await Effect.runPromise(
    checkedTree([{ path: "kb-marketplace.json", mode: "100644", bytes: new Uint8Array([0xff]) }]),
  );
  expect(Exit.isFailure(await Effect.runPromise(marketplaceTree(tree).pipe(Effect.exit)))).toBe(
    true,
  );
});
