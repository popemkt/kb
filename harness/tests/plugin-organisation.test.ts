import { describe, expect, test } from "bun:test";
import { COMPOSITIONS, composition, type Composition } from "../src/compositions.ts";
import { TAG_ALLOWS, tagEdgeViolation } from "../src/constraints.ts";

/**
 * Plugin organisation (DESIGN.md → Plugin organisation), checked over kb's
 * own compositions rather than stated: the session registry with every
 * bundled family on, the `kb ui` server's kernel with its identity
 * providers and the hosted agent, and the page's kernel with every browser
 * entry.
 *
 * - every first-party plugin carries a tag, so none escapes the rule by
 *   being unlabelled;
 * - every dependency the kernel derives keeps to `TAG_ALLOWS`: core,
 *   governance and the identity providers stand on core alone;
 * - a plugin `TAG_ALLOWS` restricts injects nothing its composition leaves
 *   unprovided, since a dependency on nobody would pass every edge check.
 */
describe("tagEdgeViolation", () => {
  test("a restricted tag allows only the tags it names", () => {
    expect(tagEdgeViolation(["core"], ["core", "ui"])).toBeUndefined();
    expect(tagEdgeViolation(["identity"], ["core"])).toBeUndefined();
    expect(tagEdgeViolation(["core", "ui"], ["lab", "ui"])).toContain("(core)");
    expect(tagEdgeViolation(["governance"], [])).toContain("(governance)");
  });

  test("a tag the table does not name restricts nothing", () => {
    expect(TAG_ALLOWS["lab"]).toBeUndefined();
    expect(tagEdgeViolation(["lab", "ui"], ["graph", "ui"])).toBeUndefined();
  });
});

describe.each([...COMPOSITIONS])("the %s composition", (name) => {
  let composed: Composition | undefined;
  const read = (): Composition => (composed ??= composition(name));

  test("every plugin is tagged", () => {
    const untagged = read().plugins.filter((plugin) => plugin.tags.length === 0);
    expect(untagged.map((plugin) => plugin.name)).toEqual([]);
  }, 60_000);

  test("every dependency keeps to TAG_ALLOWS", () => {
    const { plugins, dependencies } = read();
    const tagsOf = new Map(plugins.map((plugin) => [plugin.name, plugin.tags]));
    const violations = dependencies.flatMap(({ from, to, service }) => {
      const violation = tagEdgeViolation(tagsOf.get(from) ?? [], tagsOf.get(to) ?? []);
      return violation === undefined ? [] : [`${from} -> ${to} (${service}): ${violation}`];
    });
    expect(violations).toEqual([]);
  });

  test("a restricted plugin injects nothing its composition leaves unprovided", () => {
    const waiting = read().plugins.filter(
      (plugin) =>
        plugin.missing.length > 0 && plugin.tags.some((tag) => TAG_ALLOWS[tag] !== undefined),
    );
    expect(waiting.map(({ name: plugin, missing }) => `${plugin}: ${missing.join(", ")}`)).toEqual(
      [],
    );
  });
});
