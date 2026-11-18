import { extensionNodeId, SYSTEM_IDS, type KbNode } from "@kb/model";

/** The shared seed and entry property for each host's composition (DESIGN.md → Extension families). */
export function familyCoverageIssues(
  declarations: readonly { readonly name: string }[],
  entries: Iterable<string>,
  fold: {
    readonly nodes: readonly KbNode[];
    readonly owners: ReadonlyMap<string, string>;
  },
): string[] {
  const expected = new Set(declarations.map(({ name }) => name));
  const actual = Map.groupBy(entries, (name) => name);
  const seeded = new Set(fold.nodes.map(({ id }) => id));
  const filed = new Set(fold.nodes.find(({ id }) => id === SYSTEM_IDS.extensionsRoot)?.children);
  const issues: string[] = [];
  for (const name of expected) {
    const node = extensionNodeId(name);
    if (!seeded.has(node) || !filed.has(node) || fold.owners.get(node) !== name) {
      issues.push(`${name} has no owned seed node under ${SYSTEM_IDS.extensionsRoot}`);
    }
    const count = actual.get(name)?.length ?? 0;
    if (count !== 1) issues.push(`${name} has ${count} entries; expected one`);
  }
  for (const name of actual.keys()) {
    if (!expected.has(name)) issues.push(`unexpected family entry ${name}`);
  }
  return issues;
}
