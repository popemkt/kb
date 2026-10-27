/**
 * The page's CSS is minified by Lightning CSS, which folds an individual
 * transform property (`translate`, `rotate`, `scale`) declared beside
 * `transform` in one rule into that `transform`, applied after it. An
 * animation of the individual property then lands on top of its resting
 * value instead of replacing it, in the build only: ZZZ's wipe panel,
 * declared `transform: skewX(-16deg); translate: 135cqw 0`, held off the
 * pane and was cut off mid-sweep in every build, and looked right in dev.
 * So no rule in the page's CSS declares `transform` beside one of them; a
 * shape that needs both draws the static part some other way (a mask, a
 * child element).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { browserSources } from "@/test-support/browser-packages";

/** Every stylesheet of the page, named by its package and its path in `src`. */
function pageStylesheets(): Array<{ readonly rel: string; readonly css: string }> {
  const out: Array<{ readonly rel: string; readonly css: string }> = [];
  const walk = (name: string, src: string, dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(name, src, full);
      } else if (entry.endsWith(".css")) {
        out.push({
          rel: path.join(name, path.relative(src, full)),
          css: readFileSync(full, "utf8"),
        });
      }
    }
  };
  for (const { name, src } of browserSources()) walk(name, src, src);
  return out;
}

/** Each rule's selector and declarations, innermost blocks only (a keyframe stop is one). */
function rules(css: string): Array<{ readonly selector: string; readonly body: string }> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
    selector: selector.trim(),
    body,
  }));
}

const declares = (body: string, property: string) =>
  new RegExp(`(^|[;\\s])${property}\\s*:`).test(body);

describe("individual transform properties", () => {
  const sheets = pageStylesheets();

  it("reads the page's stylesheets, among them rules that move by `translate`", () => {
    expect(sheets.length).toBeGreaterThan(0);
    const moving = sheets
      .flatMap(({ css }) => rules(css))
      .filter(({ body }) => declares(body, "translate"));
    expect(moving.length).toBeGreaterThan(0);
  });

  it("are never declared beside `transform` in one rule, which the minifier would fold together", () => {
    const folded = sheets.flatMap(({ rel, css }) =>
      rules(css)
        .filter(
          ({ body }) =>
            declares(body, "transform") &&
            ["translate", "rotate", "scale"].some((property) => declares(body, property)),
        )
        .map(({ selector }) => `${rel}: ${selector}`),
    );
    expect(folded).toEqual([]);
  });
});
