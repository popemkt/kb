/**
 * i10 item 5 — the outline's create strips: keyboard-reachable buttons. Every
 * add row is the one ghost row (DESIGN-UI.md → Outline layout, "A ghost row
 * is an add row"), so the ghost row is where they are buttons.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outlineDir = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(outlineDir, file), "utf8");

describe("outline create strips a11y (i10 item 5)", () => {
  it("the ghost row is a keyboard-reachable, labelled button", () => {
    const ghost = read("ghost-row.tsx");
    expect(ghost).toContain('role="button"');
    expect(ghost).toContain("tabIndex={0}");
    expect(ghost).toContain("aria-label={label}");
    expect(ghost).toContain("focus-visible:ring-2");
    expect(ghost).toMatch(/e\.key !== "Enter" && e\.key !== " "/);
  });

  it("every add row is the ghost row, with a label", () => {
    for (const file of ["frame-view-slot.tsx", "outline-editor.tsx", "query-results.tsx"]) {
      expect(read(file), file).toMatch(/<GhostRow[^>]*label="[^"]+"/);
    }
  });
});
