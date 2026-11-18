import { BACKDROP_OPTIONS, DESIGN_SYSTEM_OPTIONS } from "@kb/appearance";
import {
  pointOwner,
  type CatalogRow,
  type ExtensionImpact,
  type FamilyKernel,
  type SeedReference,
} from "@kb/contracts";
import { declaredIdOf, extensionNameOf, viewIdOfOption } from "@kb/model";
import { rootPluginName } from "@kb/plugin";
import type { KbIndex } from "@kb/query";

function seedKind(target: string): SeedReference["kind"] {
  if (viewIdOfOption(target) !== null) return "view";
  if (declaredIdOf(BACKDROP_OPTIONS, target) !== undefined) return "backdrop";
  if (declaredIdOf(DESIGN_SYSTEM_OPTIONS, target) !== undefined) return "design system";
  return "other";
}

/** The reverse seed footprint, grouped by owner. Both the referent and the owner come from the index. */
export function seedReferences(index: KbIndex): ReadonlyMap<string, SeedReference[]> {
  const rows = index.runDatalog(`[:find ?family ?node ?target
    :where [?m :node/owner ?e]
           [?n :node/mentions ?m]
           (not [?n :node/owner ?e])
           [?e :node/id ?family]
           [?n :node/id ?node]
           [?m :node/id ?target]]`);
  const byFamily = new Map<string, SeedReference[]>();
  for (const [owner, node, target] of rows) {
    if (typeof owner !== "string" || typeof node !== "string" || typeof target !== "string")
      continue;
    const family = extensionNameOf(owner);
    if (family === undefined) continue;
    const refs = byFamily.get(family) ?? [];
    refs.push({ node, target, kind: seedKind(target) });
    byFamily.set(family, refs);
  }
  for (const [family, refs] of byFamily) {
    byFamily.set(
      family,
      refs.toSorted((a, b) => a.node.localeCompare(b.node) || a.target.localeCompare(b.target)),
    );
  }
  return byFamily;
}

function referenceGroups(refs: readonly SeedReference[]): ExtensionImpact["degrades"] {
  const groups = new Map<SeedReference["kind"], Set<string>>();
  for (const { node, kind } of refs) {
    const nodes = groups.get(kind) ?? new Set<string>();
    nodes.add(node);
    groups.set(kind, nodes);
  }
  return [...groups]
    .map(([kind, nodes]) => ({ kind, count: nodes.size }))
    .toSorted((a, b) => a.kind.localeCompare(b.kind));
}

type PluginImpact = ExtensionImpact["pauses"][number];

/** Removing a provider can also withdraw the registrations of the plugins depending on it. */
function pausesOf(family: string, { source, kernel }: FamilyKernel): PluginImpact[] {
  const entries = kernel.plugins().filter(({ status }) => status === "active");
  const removed = new Set([family]);
  const removedOwner = (owner: string) => rootPluginName(owner) === family || removed.has(owner);
  const roles = kernel.roles().filter(({ kind }) => kind === "service");
  const lostKeys = (entry: (typeof entries)[number]) =>
    entry.requirements.flatMap(({ kind, name, from }) => {
      if (from === null || !removedOwner(from)) return [];
      const replacement =
        kind === "service" &&
        roles
          .find(({ role }) => role === name)
          ?.candidates.some(
            ({ owner, fault, default: isDefault }) =>
              !removedOwner(owner) && (isDefault || fault === null),
          ) === true;
      return replacement ? [] : [name];
    });
  let size: number;
  do {
    size = removed.size;
    for (const entry of entries) {
      if ((entry.parent !== null && removed.has(entry.parent)) || lostKeys(entry).length > 0) {
        removed.add(entry.name);
      }
    }
  } while (removed.size > size);
  return entries.flatMap((entry) =>
    entry.name !== family &&
    removed.has(entry.name) &&
    (entry.parent === null || !removed.has(entry.parent))
      ? [{ plugin: entry.name, source, keys: lostKeys(entry) }]
      : [],
  );
}

function resumeImpact(
  family: string,
  { kernel, source }: FamilyKernel,
): Pick<ExtensionImpact, "resumes" | "unresolved"> {
  const resumes: PluginImpact[] = [];
  const unresolved: PluginImpact[] = [];
  for (const entry of kernel.plugins()) {
    if (entry.status !== "pending") continue;
    const missing = entry.requirements.filter(({ from }) => from === null);
    if (missing.length === 0) continue;
    const known = missing.filter((requirement) => requirement.family === family);
    const impact = (keys: readonly { readonly name: string }[]) => ({
      plugin: entry.name,
      source,
      keys: keys.map(({ name }) => name),
    });
    if (known.length === missing.length) {
      resumes.push(impact(known));
      continue;
    }
    const unknown = missing.filter((requirement) => !known.includes(requirement));
    // Providers registered inside apply are opaque until they run. GAP [[01M7Q11R3PYMA1KAXBER6TG792]]
    if (
      unknown.every(
        ({ kind, name }) => kind === "service" || (kind === "point" && pointOwner(name) === family),
      )
    ) {
      unresolved.push(impact(unknown));
    }
  }
  return { resumes, unresolved };
}

export function switchImpact(
  family: CatalogRow,
  on: boolean,
  kernels: readonly FamilyKernel[],
  references: readonly SeedReference[],
): ExtensionImpact {
  const result: ExtensionImpact = {
    name: family.name,
    on,
    blockedBy: [],
    pauses: [],
    degrades: [],
    resumes: [],
    restores: [],
    unresolved: [],
  };
  if (family.selection === undefined || family.selection.on === on) return result;
  const groups = referenceGroups(references);
  if (on) {
    result.restores = groups;
    for (const kernel of kernels) {
      const { resumes, unresolved } = resumeImpact(family.name, kernel);
      result.resumes.push(...resumes);
      result.unresolved.push(...unresolved);
    }
  } else {
    result.degrades = groups;
    result.pauses = kernels.flatMap((kernel) => pausesOf(family.name, kernel));
  }
  return result;
}
