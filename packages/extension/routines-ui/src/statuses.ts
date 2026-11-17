/**
 * The sync host's statuses as this page hears them on the family's channel
 * (docs/research/2026-11-02-kb-routines-gcal.md → Status lives in the host).
 * The store holds none: they live in the host and arrive here.
 *
 * One listener per page. The first reader listens and says `WATCH_STATUSES`
 * while the connection is the person's, and says it again each time the
 * connection comes back to them, because the host forgets a connection that
 * closes. The last reader to leave stops listening. What is not heard is not
 * known: with no host, an offline socket or no answer yet, every target reads
 * as not synced yet, and nothing claims an event is synced.
 */
import { useSyncExternalStore } from "react";
import { Schema } from "effect";
import {
  entryStatus,
  NO_STATUSES,
  STATUS_CHANNEL,
  SyncStatuses,
  WATCH_STATUSES,
  type CalendarEntry,
  type SyncStatus,
} from "@kb/routines";
import { browserHost } from "@kb/ui-sdk";

const isStatuses = Schema.is(SyncStatuses);

let heard: SyncStatuses = NO_STATUSES;
const readers = new Set<() => void>();
let detach: (() => void) | null = null;

function hear(next: SyncStatuses): void {
  if (next === heard) return;
  heard = next;
  for (const reader of readers) reader();
}

function attach(): () => void {
  const host = browserHost();
  const channel = host.channel(STATUS_CHANNEL);
  const unlisten = channel.listen({
    data: (data) => {
      if (isStatuses(data)) hear(data);
    },
    // No host owns the channel, or the tab is not the person's: nothing is known.
    error: () => hear(NO_STATUSES),
  });
  let standing = host.standing();
  if (standing === "person") channel.send(WATCH_STATUSES);
  const unsubscribe = host.subscribe(() => {
    const now = host.standing();
    if (now === standing) return;
    standing = now;
    if (now === "person") channel.send(WATCH_STATUSES);
    else hear(NO_STATUSES);
  });
  return () => {
    unlisten();
    unsubscribe();
  };
}

function subscribe(reader: () => void): () => void {
  readers.add(reader);
  detach ??= attach();
  return () => {
    readers.delete(reader);
    if (readers.size > 0) return;
    detach?.();
    detach = null;
    heard = NO_STATUSES;
  };
}

const read = () => heard;

/** The host's statuses as this page last heard them. */
export function useSyncStatuses(): SyncStatuses {
  return useSyncExternalStore(subscribe, read);
}

/** An instance's status: its own write's, or its series' (`entryStatus`). */
export function useEntryStatus(
  entry: Pick<CalendarEntry, "routine" | "on" | "series"> | undefined,
): SyncStatus | null {
  const statuses = useSyncStatuses();
  return entry === undefined ? null : entryStatus(statuses, entry).status;
}
