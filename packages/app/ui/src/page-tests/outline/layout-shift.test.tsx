/**
 * i10 item 2 — layout-shift regression: hover/state must not change measured
 * width of tag chips, palette shell, or field rows.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TagChip } from "@kb/ui-sdk";
import { browserSource } from "@/test-support/browser-packages";

const outlineDir = browserSource("@kb/outline-ui");

describe("layout-shift regressions (i10)", () => {
  it("TagChip remove overlay never changes chip width on hover", () => {
    const withRemove = renderToStaticMarkup(
      createElement(TagChip, {
        tag: { id: "tag.todo", name: "todo", color: "#8b5cf6" },
        onClick: () => undefined,
        onRemove: () => undefined,
      }),
    );
    const withoutRemove = renderToStaticMarkup(
      createElement(TagChip, {
        tag: { id: "tag.todo", name: "todo", color: "#8b5cf6" },
        onClick: () => undefined,
      }),
    );

    // Remove control is present but absolutely positioned in a fixed mark slot.
    expect(withRemove).toContain('data-tag-chip="true"');
    expect(withRemove).toContain('data-tag-remove="true"');
    expect(withRemove).toContain("absolute inset-0");
    expect(withRemove).toContain("opacity-0");
    expect(withRemove).toContain("group-hover/tag:opacity-60");
    expect(withRemove).not.toContain("group-hover/tag:flex");
    expect(withRemove).toContain('data-tag-mark="true"');
    // Mark scales in em off --type-tag rather than pinning its own px box.
    expect(withRemove).toContain("w-[1em]");

    // Label + mark anatomy matches the no-remove chip (only overlay button added).
    expect(withRemove).toContain(">todo</span>");
    expect(withoutRemove).toContain(">todo</span>");
    // Both carry the same token class; the height itself lives on .kb-tag.
    expect(withRemove).toContain("kb-tag");
    expect(withoutRemove).toContain("kb-tag");
    expect(withRemove).not.toMatch(/h-\[\d+px\]/);
    expect(withoutRemove).not.toMatch(/h-\[\d+px\]/);

    const src = readFileSync(
      path.join(browserSource("@kb/ui-sdk"), "components/tag-chip.tsx"),
      "utf8",
    );
    expect(src).toContain("absolute inset-0");
    expect(src).not.toMatch(/hidden[\s\S]*group-hover\/tag:flex/);
  });

  it("CommandPalette shell keeps fixed max width empty and matched", () => {
    const src = readFileSync(
      path.join(browserSource("@kb/ui"), "components/palette/command-palette.tsx"),
      "utf8",
    );
    expect(src).toMatch(/w-full max-w-\[520px\]/);
    expect(src).toMatch(/max-h-\[min\(20\*2rem,50vh\)\]/);
  });

  it("node command palette always occupies the list slot", () => {
    const src = readFileSync(path.join(outlineDir, "node-command-palette.tsx"), "utf8");
    expect(src).toContain('data-palette-list="true"');
    expect(src).toContain("min-h-[2.5rem]");
    expect(src).not.toMatch(/items\.length > 0 && \(/);
  });

  it("the main scroll region keeps no scrollbar gutter, its scrollbar kb's own thumb", () => {
    const src = readFileSync(
      path.join(browserSource("@kb/ui"), "components/layout/pane-frame.tsx"),
      "utf8",
    );
    const css = readFileSync(path.join(browserSource("@kb/ui"), "index.css"), "utf8");
    // One owner of a pane's scroll region — the className is not restated per route.
    expect(src).toMatch(/function ScrollRegion\(/);
    expect((src.match(/<main\b/g) ?? []).length).toBe(1);
    expect(src).not.toMatch(/className="min-h-0 flex-1 overflow-(?:auto|hidden)"/);
    // Every page in a pane is framed by the one call site, canvas
    // (non-scrolling) included: the frame is data on the surface.
    expect((src.match(/<ScrollRegion\b/g) ?? []).length).toBe(1);
    // No gutter at all, so a view that overflows and one that does not resolve
    // to the same content width on every platform (the centered column, and
    // with it the breadcrumb, cannot shift), and a region-spanning breakout
    // reaches the pane's edge. Its scrollbar is the one thumb drawn over it.
    expect(css).toMatch(/\[data-main-region="scroll"\] \{[^}]*scrollbar-width: none;/s);
    expect(css).toMatch(/\[data-main-region="scroll"\]::-webkit-scrollbar \{\s*display: none;/);
    expect(src).toMatch(/<RegionScrollbar region=\{region\} \/>/);
    expect(src).not.toMatch(/\[scrollbar-gutter:|overflow-y-scroll/);
    // Pinned at the region itself, so a later edit cannot quietly drop its scrolling.
    expect(src).toMatch(/scroll \? "overflow-x-auto overflow-y-auto"/);
    // And the shift is fixed at the scroll region, not compensated downstream.
    const crumbs = readFileSync(path.join(outlineDir, "breadcrumbs.tsx"), "utf8");
    expect(crumbs).not.toMatch(/scrollbar|margin-left|\bml-|padding-right|\bpr-/);
  });
});
