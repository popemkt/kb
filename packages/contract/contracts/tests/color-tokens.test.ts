import { expect, test } from "bun:test";
import { Effect } from "effect";
import { makeKernel } from "@kb/plugin";
import { declarationPlugin, extensionRow } from "../src/declaration.ts";
import { COLOR_TOKEN_FALLBACKS, ColorTokenPoint, colorTokenReader } from "../src/design-tokens.ts";

test("a pure declaration catalogue resolves SSR fallbacks without a browser or host", () => {
  const reader = colorTokenReader([COLOR_TOKEN_FALLBACKS, { "--example-colour": "#123456" }]);
  expect(reader.fallback("--example-colour")).toBe("#123456");
  expect(reader.fallback("--foreground")).toBe("#222");
  expect(() => reader.fallback("--missing")).toThrow("undeclared colour token");
});

test("repeated identical tokens compose, but conflicting owners cannot silently override", () => {
  expect(
    colorTokenReader([{ "--example": "#123" }, { "--example": "#123" }]).fallback("--example"),
  ).toBe("#123");
  expect(() => colorTokenReader([{ "--example": "#123" }, { "--example": "#456" }])).toThrow(
    "conflicting colour token",
  );
});

test("only loaded declarations contribute tokens, and catalogue rows carry no token metadata", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const declaration = {
        name: "example",
        label: "Example",
        colorTokens: { "--example": "#123" },
      };
      const kernel = makeKernel({ host: "registry" });
      expect(kernel.contributions(ColorTokenPoint)).toEqual([]);
      expect(extensionRow(declaration, "bundled", false)).not.toHaveProperty("colorTokens");
      yield* kernel.load(declarationPlugin(declaration));
      expect(kernel.contributions(ColorTokenPoint).map(({ value }) => value)).toEqual([
        declaration.colorTokens,
      ]);
      yield* kernel.unload(declaration.name);
      expect(kernel.contributions(ColorTokenPoint)).toEqual([]);
      yield* kernel.shutdown;
    }),
  );
});
