/**
 * What the Extensions panel draws (DESIGN-UI.md → Extensions panel): the
 * server's report (`extension.list`) and footprint (`extension.footprint`),
 * joined with the page's own kernel through the same readers the server
 * uses (`organisationOf`, `orderedPoints`, `pageFootprint`). The server's
 * half is read again whenever the page reads its manifest again, so a
 * switch is drawn as the server then has it; the page's half is read again
 * whenever the page kernel moves.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ExtensionReportSchema,
  FootprintRowSchema,
  orderedPoints,
  organisationOf,
  type ExtensionReport,
  type FootprintRow,
} from "@kb/contracts";
import { extensionSwitchDef } from "@kb/operations";
import {
  PAGE_FAMILY_KERNEL,
  pageFootprint,
  subscribeUiKernel,
  toast,
  uiKernelReader,
} from "@kb/ui-sdk";
import { z } from "zod";
import { loadManifest, subscribeManifest } from "@/lib/manifest";
import { invoke } from "@/session/runtime";

/** Where the panel is: the path its route matches and every way in navigates to. */
export const EXTENSIONS_PATH = "/extensions";

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
export interface PanelReport {
  readonly extensions: readonly PanelExtension[];
  readonly points: ExtensionReport["points"];
  readonly failures: ExtensionReport["failures"];
}

async function readServer(): Promise<ServerReport | string> {
  const [listed, footprint] = await Promise.all([
    invoke("extension.list", {}),
    invoke("extension.footprint", {}),
  ]);
  if (listed.status === "failed") return listed.message;
  const report = ExtensionReportSchema.safeParse(listed.output);
  if (!report.success) return `extension.list answered in another shape: ${report.error.message}`;
  const rows = FootprintOutput.safeParse(
    footprint.status === "succeeded" ? footprint.output : null,
  );
  return { report: report.data, footprint: rows.success ? rows.data.rows : [] };
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

/** The server's half joined with the page kernel as it is at `_page`. */
function joinPage(server: ServerReport, _page: PageKernelAt): PanelReport {
  const page = [PAGE_FAMILY_KERNEL];
  return {
    extensions: server.report.extensions.map((row) => {
      const onPage = organisationOf(row.name, page);
      const own = server.footprint.filter((entry) => entry.family === row.name);
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
    }),
    points: [...server.report.points, ...orderedPoints(page)],
    failures: server.report.failures,
  };
}

/**
 * The panel's reading, or why the server could not give it: the server's
 * half read on mount and whenever the manifest is read again, the page's
 * joined in whenever the page kernel moves.
 */
export function useExtensionReport(): PanelReport | string | null {
  const [server, setServer] = useState<ServerReport | string | null>(null);
  useEffect(() => {
    let live = true;
    const read = async () => {
      const next = await readServer();
      if (live) setServer(next);
    };
    void read();
    const unsubscribe = subscribeManifest(() => void read());
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  const page = useSyncExternalStore(subscribeUiKernel, readPageAt, readPageAt);
  return useMemo(
    () => (server === null || typeof server === "string" ? server : joinPage(server, page)),
    [server, page],
  );
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
