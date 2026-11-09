import { SYSTEM_IDS, extensionNameOf, type KbNode } from "./model.ts";
import { refValuesOf } from "./ontology.ts";

/** A bundled owner's role, materialized by the seed fold. */
export interface RoleDefinition {
  readonly role: string;
  readonly label: string;
}

export function roleNodeId(role: string): string {
  return `sys.role.${role}`;
}

/** The graph is the configuration; the kernel receives only its derived preferences. */
export function roleSelections(
  roles: Iterable<{ readonly role: string }>,
  nodeOf: (id: string) => Pick<KbNode, "id" | "props"> | undefined,
): ReadonlyMap<string, string> {
  const preferences = new Map<string, string>();
  const prefix = roleNodeId("");
  for (const { role } of roles) {
    const node = nodeOf(roleNodeId(role));
    if (node === undefined) continue;
    if (
      !node.id.startsWith(prefix) ||
      !refValuesOf(node, SYSTEM_IDS.typeField).includes(SYSTEM_IDS.roleTag)
    )
      continue;
    const selected = refValuesOf(node, SYSTEM_IDS.providerField)[0];
    const family = selected === undefined ? undefined : extensionNameOf(selected);
    if (family !== undefined) preferences.set(node.id.slice(prefix.length), family);
  }
  return preferences;
}
