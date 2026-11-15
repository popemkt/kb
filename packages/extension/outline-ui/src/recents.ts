/**
 * Recent (DESIGN-UI.md → Node-scoped commands, "Recent is screen state"):
 * the nodes an outline last stood at, newest first and `RECENT_LIMIT` at
 * most. It is this browser's alone, kept in `localStorage` in the
 * `loadIdSet` encoding, whose order is the list's; nothing here writes to
 * the store. GAP [[01M7D6DPTPPKEY515V7J3FJDM4]]
 */
import { useEffect, useSyncExternalStore } from "react";
import { browserHost, loadIdSet, saveIdSet, useSchema, WORKSPACE_ROOT_ID } from "@kb/ui-sdk";

export const RECENT_STORAGE_KEY = "kb-recent";
export const RECENT_LIMIT = 10;

const listeners = new Set<() => void>();
/** The last list read, and the stored text it was read from. */
let read: { readonly raw: string | null; readonly ids: readonly string[] } = { raw: null, ids: [] };

function storedText(): string | null {
  try {
    return localStorage.getItem(RECENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The recent ids as storage holds them, one list while what it holds is unchanged. */
function recent(): readonly string[] {
  const raw = storedText();
  if (raw !== read.raw) read = { raw, ids: [...loadIdSet(RECENT_STORAGE_KEY)] };
  return read.ids;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Put `id` first in Recent, dropping the ids `holds` says the graph no
 * longer holds and keeping `RECENT_LIMIT`. Already first, nothing is written.
 */
export function recordRecent(id: string, holds: (id: string) => boolean): void {
  const before = recent();
  const next = [id, ...before.filter((other) => other !== id && holds(other))].slice(
    0,
    RECENT_LIMIT,
  );
  if (next.length === before.length && next.every((other, at) => other === before[at])) return;
  saveIdSet(RECENT_STORAGE_KEY, new Set(next));
  for (const listener of listeners) listener();
}

/** The recent ids, newest first, as storage holds them. */
export function useRecent(): readonly string[] {
  return useSyncExternalStore(subscribe, recent);
}

/**
 * Record `id` in Recent while an outline stands at it: not at the home
 * (`homeId`), and not at a node the graph does not hold.
 */
export function useRecordRecent(id: string, homeId: string): void {
  const holds = useSchema().has(id);
  // Once per arrival: the graph moving under the page is no visit.
  useEffect(() => {
    if (id === homeId || id === WORKSPACE_ROOT_ID || !holds) return;
    const schema = browserHost().schema();
    recordRecent(id, (other) => schema.has(other));
  }, [id, homeId, holds]);
}
