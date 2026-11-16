import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KB_TEXT_CLASS, assetSrcUrl } from "./md-inline.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// The design tokens are still the page's stylesheets, in `@kb/ui`'s src.
const pageSrc = path.join(here, "../../../../app/ui/src");

describe("assetSrcUrl", () => {
  it("serves an asset path from the page's static route", () => {
    expect(assetSrcUrl("assets/a.png")).toBe("/assets/a.png");
  });
});

describe("line-height consistency (edit vs view)", () => {
  it("edit and view share KB_TEXT_CLASS / .kb-text token", () => {
    const tokens = readFileSync(path.join(pageSrc, "tokens.css"), "utf8");
    const content = readFileSync(path.join(here, "../components/node-text-host.tsx"), "utf8");
    expect(KB_TEXT_CLASS).toBe("kb-text");
    expect(tokens).toMatch(/\.kb-text\s*\{[^}]*var\(--type-body\)/s);
    // Both modes must apply the same token class (equal computed font/line-height).
    expect(content).toContain(`KB_TEXT_CLASS`);
    expect(content).toMatch(/isActive[\s\S]*KB_TEXT_CLASS/);
  });
});
