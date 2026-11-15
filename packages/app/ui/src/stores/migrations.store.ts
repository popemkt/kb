/**
 * The data migrations the loaded families declare, as `migration.list`
 * reads them (DESIGN-UI.md → Settings → One list of migrations). This is the
 * one reading Settings' Migrations group and the header's line share, so the
 * page shows the set, the states and the pending that `kb migrate` and MCP
 * list. It also holds which pending migrations the person dismissed the
 * line for, this session only.
 */
import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import type { z } from "zod";
import { MigrationListSchema } from "@kb/contracts";
import { failureText } from "@kb/ui-sdk";
import { latestRead } from "@/lib/latest-read";
import { subscribeManifest } from "@/lib/manifest";
import { invoke } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store";

/** One migration as `migration.list` answers it. */
export type MigrationRow = z.infer<typeof MigrationListSchema>["migrations"][number];

/** The list; why it could not be read; or null until it first answers. */
export type MigrationsReading = readonly MigrationRow[] | string | null;

interface MigrationsState {
  readonly reading: MigrationsReading;
  /** The pending migrations the person dismissed the header's line for. */
  readonly dismissed: ReadonlySet<string>;
}

export const useMigrationsStore = create<MigrationsState>(() => ({
  reading: null,
  dismissed: new Set(),
}));

async function readList(): Promise<readonly MigrationRow[] | string> {
  try {
    const receipt = await invoke("migration.list", {});
    if (receipt.status === "failed") return failureText(receipt);
    return MigrationListSchema.parse(receipt.output).migrations;
  } catch (cause) {
    return String(cause);
  }
}

/** Read the list again; only the latest reading publishes. */
export const readMigrations = latestRead(readList, (reading) =>
  useMigrationsStore.setState({ reading }),
);

/** The migrations of `reading` that are pending; none while it is unread or failed. */
export function pendingOf(reading: MigrationsReading): readonly MigrationRow[] {
  return typeof reading === "object" && reading !== null ? reading.filter((m) => m.pending) : [];
}

/** Dismiss the header's line for `ids`, this session; one pending later brings it back. */
export function dismissMigrations(ids: readonly string[]): void {
  useMigrationsStore.setState((state) => ({ dismissed: new Set([...state.dismissed, ...ids]) }));
}

/** What the header's line names: the pending migrations not dismissed this session. */
export function useMigrationsToReview(): readonly MigrationRow[] {
  const reading = useMigrationsStore((state) => state.reading);
  const dismissed = useMigrationsStore((state) => state.dismissed);
  return useMemo(
    () => pendingOf(reading).filter((m) => !dismissed.has(m.id)),
    [reading, dismissed],
  );
}

/**
 * Keep the reading current: read on mount and whenever the manifest is read
 * again (the families changed). While any family declares a migration, read
 * after each write as well, so a step taken on any surface moves the page.
 * With none declared, a write costs no reading.
 */
export function useFollowMigrations(): void {
  const rev = useGraphStore((state) => state.rev);
  const declares = useMigrationsStore(
    (state) => typeof state.reading === "object" && (state.reading?.length ?? 0) > 0,
  );
  const seen = useRef(rev);
  useEffect(() => {
    void readMigrations();
    return subscribeManifest(() => void readMigrations());
  }, []);
  useEffect(() => {
    if (seen.current === rev) return;
    seen.current = rev;
    if (declares) void readMigrations();
  }, [rev, declares]);
}
