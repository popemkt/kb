/**
 * The outline's paste and drop (DESIGN-UI.md → Paste and drop): it declares
 * `outline.ingest`, contributes its own handlers to it as any family does,
 * and binds each row's text host to the chain at that row: a pasted list
 * becomes nodes after it, as rows copied from kb do (`outline-paste`), a
 * dropped file is attached, and any other paste goes into the row as text,
 * kb's own copied text as its source.
 */
import { useMemo } from "react";
import { OUTLINE_POINT_DEFINITIONS } from "@kb/outline";
import { PointName, type ContributionEntry } from "@kb/plugin";
import {
  ATTACH_FILE,
  ingestPort,
  PASTE_KB_TEXT,
  PASTE_TEXT,
  useContributions,
  type IngestHandler,
  type IngestPort,
} from "@kb/ui-sdk";
import { PASTE_KB_OUTLINE, PASTE_LIST } from "./outline-paste";

/** The outline's paste and drop handlers, by the name its family's point definitions give it. */
export const IngestPoint = PointName<IngestHandler>()(OUTLINE_POINT_DEFINITIONS.ingest.name);

/** The outline's own handlers: kb's own rows and text pasted, a pasted list, a dropped file, and, last, any paste as text. */
export const OUTLINE_INGESTS: readonly ContributionEntry<IngestHandler>[] = [
  { id: "paste-kb-outline", value: PASTE_KB_OUTLINE },
  { id: "paste-kb-text", value: PASTE_KB_TEXT },
  { id: "paste-list", value: PASTE_LIST },
  { id: "attach-file", value: ATTACH_FILE },
  { id: "paste-text", value: PASTE_TEXT },
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
