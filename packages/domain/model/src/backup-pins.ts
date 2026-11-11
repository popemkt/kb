import { SYSTEM_IDS, type KbNode } from "./model.ts";

/** The backups `nodes` pin (`backup pin`): kept out of retention, whatever their age. */
export function pinnedBackups(nodes: readonly KbNode[]): string[] {
  const pinned = new Set<string>();
  for (const node of nodes)
    for (const value of node.props[SYSTEM_IDS.backupPinField] ?? [])
      if (value.t === "str") pinned.add(value.v);
  return [...pinned];
}
