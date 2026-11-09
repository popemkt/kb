/**
 * The outline's paste and drop (DESIGN-UI.md → Paste and drop): it declares
 * `outline.ingest`, contributes its own handlers to it as any family does,
 * and binds each row's text host to the chain at that row.
 */
import { useMemo } from "react";
import { OUTLINE_POINT_DEFINITIONS } from "@kb/outline";
import { PointName, type ContributionEntry } from "@kb/plugin";
import {
  ATTACH_FILE,
  ingestPort,
  useContributions,
  type IngestHandler,
  type IngestPort,
} from "@kb/ui-sdk";

/** The outline's paste and drop handlers, by the name its family's point definitions give it. */
export const IngestPoint = PointName<IngestHandler>()(OUTLINE_POINT_DEFINITIONS.ingest.name);

/** The outline's own handlers: a dropped file. */
export const OUTLINE_INGESTS: readonly ContributionEntry<IngestHandler>[] = [
  { id: "attach-file", value: ATTACH_FILE },
];

/** The port a row's text host offers its pastes and drops to: the chain, at the node `nodeId` whose text is `text`. */
export function useRowIngest(nodeId: string, text: string): IngestPort {
  const contributed = useContributions(IngestPoint);
  return useMemo(
    () =>
      ingestPort(
        () => contributed.map(({ value }) => value),
        () => ({ nodeId, text }),
      ),
    [contributed, nodeId, text],
  );
}
