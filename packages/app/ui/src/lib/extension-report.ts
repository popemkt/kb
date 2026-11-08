/**
 * What Settings' Extensions and Advanced parts draw (DESIGN-UI.md →
 * Settings → Extensions): the
 * server's report (`extension.list`) and footprint (`extension.footprint`),
 * joined with the page's own kernel through the same readers the server
 * uses (`organisationOf`, `orderedPoints`, `pageFootprint`). The server's
 * half is read again whenever the page reads its manifest again, so a
 * switch is drawn as the server then has it; the page's half is read again
 * whenever the page kernel moves.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ExtensionReportSchema,
  FootprintRowSchema,
  orderedPoints,
  organisationOf,
  type ExtensionReport,
  type FootprintRow,
  type ExtensionRow,
} from "@kb/contracts";
import { extensionSwitchDef, extensionDiffDef, marketplaceListDef } from "@kb/operations";
import {
  PAGE_FAMILY_KERNEL,
  latestRead,
  pageFootprint,
  subscribeUiKernel,
  toast,
  uiKernelReader,
} from "@kb/ui-sdk";
import { z } from "zod";
import { loadManifest, subscribeManifest } from "@/lib/manifest";
import { invoke } from "@/session/runtime";

const FootprintOutput = z.object({ rows: z.array(FootprintRowSchema) });

/** The server's half: what it composes, and what each family contributed to its kernels. */
interface ServerReport {
  readonly report: ExtensionReport;
  readonly footprint: readonly FootprintRow[];
}

/** One extension as the panel draws it: the server's row, its page half joined in. */
export interface PanelExtension {
  readonly row: ExtensionReport["extensions"][number];
  /** Every runtime contribution, the server's and the page's, grouped under the point it went to. */
  readonly contributions: ReadonlyMap<string, readonly FootprintRow[]>;
  /** How many nodes its declaration seeds. */
  readonly seeds: number;
}

/** The panel's whole reading; null until the server has answered once. */
export interface PanelExtensionGroup {
  readonly name: string;
  readonly effective: PanelExtension | undefined;
  readonly hidden: readonly ExtensionReport["extensions"][number][];
}

export interface PanelReport {
  readonly groups: readonly PanelExtensionGroup[];
  readonly points: ExtensionReport["points"];
  readonly failures: ExtensionReport["failures"];
}

/** The catalog is parsed in one place, shared by every extension reading. */
type CatalogRead = { readonly report: ExtensionReport } | { readonly problem: string };

export function readExtensionCatalog(): Promise<CatalogRead> {
  return invoke("extension.list", {}).then((receipt) => {
    if (receipt.status === "failed") return { problem: receipt.message } as const;
    const parsed = ExtensionReportSchema.safeParse(receipt.output);
    return parsed.success
      ? ({ report: parsed.data } as const)
      : ({ problem: `extension.list answered in another shape: ${parsed.error.message}` } as const);
  });
}

/**
 * Ask the server for both halves. Never rejects: a request that could not
 * be made, or either action failing, is the reason the panel shows in
 * place of the report, since a missing footprint would read as a family
 * that contributed nothing.
 */
async function readServer(): Promise<ServerReport | string> {
  try {
    const [listed, footprint] = await Promise.all([
      readExtensionCatalog(),
      invoke("extension.footprint", {}),
    ]);
    if ("problem" in listed) return listed.problem;
    if (footprint.status === "failed") return footprint.message;
    const rows = FootprintOutput.safeParse(footprint.output);
    if (!rows.success)
      return `extension.footprint answered in another shape: ${rows.error.message}`;
    return { report: listed.report, footprint: rows.data.rows };
  } catch (error) {
    return `the server could not be asked: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Group rows under the point each went to, in the order the points first appear. */
function byPoint(rows: readonly FootprintRow[]): ReadonlyMap<string, readonly FootprintRow[]> {
  const grouped = new Map<string, FootprintRow[]>();
  for (const row of rows) grouped.set(row.kind, [...(grouped.get(row.kind) ?? []), row]);
  return grouped;
}

/** The page kernel at one version: a new one each time the kernel moves. */
interface PageKernelAt {
  readonly version: number;
}

let pageAt: PageKernelAt = { version: -1 };

function readPageAt(): PageKernelAt {
  const version = uiKernelReader.version();
  if (pageAt.version !== version) pageAt = { version };
  return pageAt;
}

/** Source scope is presentation of the catalog's declared origin, never inferred from paths. */
export function extensionSourceLabel(row: Pick<ExtensionRow, "origin" | "source">): string {
  const origin = row.origin;
  if (origin === undefined) return row.source;
  switch (origin.kind) {
    case "own":
      return "own folder";
    case "link":
      return `${origin.scope} link`;
    case "install":
      return `${origin.scope} install`;
    default:
      return origin satisfies never;
  }
}

/** One name owns its effective reading and all the sources the catalog says it hides. */
function catalogGroups(rows: ExtensionReport["extensions"]) {
  type Group = { name: string; effective?: (typeof rows)[number]; hidden: (typeof rows)[number][] };
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const group: Group = groups.get(row.name) ?? { name: row.name, hidden: [] };
    if (row.shadowed === undefined) group.effective = row;
    else group.hidden.push(row);
    groups.set(row.name, group);
  }
  return [...groups.values()];
}

/** A footprint belongs to the effective family, never to a hidden copy with the same name. */
function joinExtension(
  row: ExtensionReport["extensions"][number],
  footprint: readonly FootprintRow[],
): PanelExtension {
  const onPage = organisationOf(row.name, [PAGE_FAMILY_KERNEL]);
  const own = footprint.filter((entry) => entry.family === row.name);
  return {
    row: {
      ...row,
      tags: [...new Set([...row.tags, ...onPage.tags])],
      injects: [...row.injects, ...onPage.injects],
      provides: [...row.provides, ...onPage.provides],
      failures: [...row.failures, ...onPage.failures],
    },
    contributions: byPoint([
      ...own.filter((entry) => entry.source !== "seed"),
      ...pageFootprint(row.name),
    ]),
    seeds: own.filter((entry) => entry.source === "seed").length,
  };
}

/** The server's half joined with the page kernel as it is at `_page`. */
function joinPage(server: ServerReport, _page: PageKernelAt): PanelReport {
  return {
    groups: catalogGroups(server.report.extensions).map((group) => ({
      ...group,
      effective:
        group.effective === undefined
          ? undefined
          : joinExtension(group.effective, server.footprint),
    })),
    points: [...server.report.points, ...orderedPoints([PAGE_FAMILY_KERNEL])],
    failures: server.report.failures,
  };
}

/** The panel's reading, and how to ask the server again. */
export interface ExtensionReading {
  /** The report; why the server could not give it; or null until it first answers. */
  readonly report: PanelReport | string | null;
  readonly reread: () => void;
}

/**
 * The panel's reading: the server's half read on mount, whenever the
 * manifest is read again, and on `reread`; the page's joined in whenever
 * the page kernel moves.
 */
export function useExtensionReport(): ExtensionReading {
  const [server, setServer] = useState<ServerReport | string | null>(null);
  /** Read the server's half again; a no-op once unmounted. */
  const readAgain = useRef<() => void>(() => {});
  useEffect(() => {
    let live = true;
    const read = latestRead(readServer, (next) => {
      if (live) setServer(next);
    });
    readAgain.current = () => void read();
    void read();
    const unsubscribe = subscribeManifest(() => void read());
    return () => {
      live = false;
      readAgain.current = () => {};
      unsubscribe();
    };
  }, []);
  const page = useSyncExternalStore(subscribeUiKernel, readPageAt, readPageAt);
  const report = useMemo(
    () => (server === null || typeof server === "string" ? server : joinPage(server, page)),
    [server, page],
  );
  const reread = useCallback(() => readAgain.current(), []);
  return useMemo(() => ({ report, reread }), [report, reread]);
}

/**
 * Switch an optional family on the server, then read its manifest again,
 * which the page and the panel follow. A refusal is shown, and both stay as
 * the server has it.
 */
export async function switchExtension(name: string, on: boolean): Promise<void> {
  const receipt = await invoke(extensionSwitchDef.id, { name, on });
  if (receipt.status === "failed") toast(receipt.message);
  await loadManifest();
}

/** Cached review data must belong to the same selection the person is reviewing. */
export function readExtensionDiff(row: ExtensionRow) {
  return invoke(extensionDiffDef.id, { name: row.name }).then((receipt) => {
    if (receipt.status === "failed") throw new Error(receipt.message);
    const diff = extensionDiffDef.outputSchema.parse(receipt.output);
    if (diff.to !== row.files)
      throw new Error("The selected files changed while reading the review. Open it again.");
    return diff;
  });
}

export function readMarketplaces() {
  return invoke(marketplaceListDef.id, {}).then((receipt) => {
    if (receipt.status === "failed") throw new Error(receipt.message);
    return marketplaceListDef.outputSchema.parse(receipt.output).marketplaces;
  });
}
