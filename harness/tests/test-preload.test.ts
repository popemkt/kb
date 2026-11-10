import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PACKAGE_BUNFIG,
  PACKAGES_ROOT,
  WORKSPACE_ROOT,
  axisValues,
  tagsOf,
  workspacePackages,
} from "../src/workspace.ts";

/**
 * A `bun test` run is isolated wherever it is started (DESIGN.md → kb Home
 * Store): its scratch home and per-test data come from one preload list,
 * `@kb/test-kit`'s `preload.ts`. Bun reads only the `bunfig.toml` of the
 * directory it runs in, so the root names that list for a root run and each
 * `bun test` package names it for a run from its own directory. Without the
 * package's, its suite shares one `KB_DATA` across tests, and the trust one
 * test leaves is the next one's.
 *
 * Red case: delete a non-browser package's `bunfig.toml`, or point its
 * preload at a file that is not there.
 */
describe("test-preload", () => {
  test("every bun test package carries the package bunfig, which names the one list", () => {
    const wrong = workspacePackages().flatMap(({ dir, name, manifest }) => {
      if (axisValues(tagsOf(manifest), "scope")[0] === "browser") return [];
      const path = join(PACKAGES_ROOT, dir, "bunfig.toml");
      if (!existsSync(path)) return [`${name}: no bunfig.toml`];
      return readFileSync(path, "utf8") === PACKAGE_BUNFIG ? [] : [`${name}: bunfig.toml differs`];
    });
    expect(wrong, `${wrong.join("\n")}\n\nexpected:\n${PACKAGE_BUNFIG}`).toEqual([]);
  });

  test("the package bunfig's preload is the root's, seen from a package directory", () => {
    const parsed = Bun.TOML.parse(PACKAGE_BUNFIG) as { test?: { preload?: string[] } };
    const root = Bun.TOML.parse(readFileSync(join(WORKSPACE_ROOT, "bunfig.toml"), "utf8")) as {
      test?: { preload?: string[] };
    };
    const fromPackage = (parsed.test?.preload ?? []).map((path) =>
      resolve(PACKAGES_ROOT, "layer", "name", path),
    );
    const fromRoot = (root.test?.preload ?? []).map((path) => resolve(WORKSPACE_ROOT, path));
    expect(fromPackage).toEqual(fromRoot);
    expect(fromRoot.every((path) => existsSync(path))).toBe(true);
  });
});
