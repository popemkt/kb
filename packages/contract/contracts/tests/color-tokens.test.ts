import { expect, test } from "bun:test";
import { COLOR_TOKEN_FALLBACKS, colorTokenReader } from "../src/design-tokens.ts";

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
