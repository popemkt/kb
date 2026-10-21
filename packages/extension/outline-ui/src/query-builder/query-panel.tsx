/**
 * A query node's builder (docs/brainstorms/2026-10-20-query-builder): two
 * tabs over the one stored `sys.f.query`, and the count of what it answers.
 *
 * - **EDN in `sys.f.query` is the one source of truth.** The Conditions tab
 *   is what the stored text lifts to (`readQuery`), read again on every
 *   change to it, whoever wrote it; the EDN tab is the text itself. A query
 *   that does not lift offers only the EDN tab, and says why.
 * - **Every condition edit is a write**, printed canonically
 *   (`writtenEdn`). The tree the person built is kept on screen for as long
 *   as the stored text is one it wrote; a write from anywhere else is
 *   lifted and shown instead.
 * - **Opening never writes.** Nothing here writes until a person edits.
 * - The tab last used for a node is the outline's screen state
 *   (`queryTabs`); a node it has never seen opens Conditions.
 */
import { useState } from "react";
import type { WireNode } from "@kb/contracts";
import { readsAsEdn } from "@kb/query";
import {
  browserHost,
  cn,
  EdnEditor,
  type GraphRead,
  indentStyle,
  SYSTEM_IDS,
  usePageGraph,
} from "@kb/ui-sdk";
import { NodeField } from "../fields-section";
import { outlineNodes, useOutlineStore, type QueryTab } from "../outline.store";
import { ConditionsEditor } from "./conditions";
import { CountChip, type QueryCount } from "./count-chip";
import { readQuery, writtenEdn, type BuilderTree } from "./model";

/** Replace the node's query with `text`, as typed: its one value, whatever it is now. */
function writeQuery(nodeId: string, text: string): void {
  const [old] = outlineNodes().get(nodeId)?.props[SYSTEM_IDS.queryField] ?? [];
  void browserHost().writes.updateProp(nodeId, SYSTEM_IDS.queryField, { t: "str", v: text }, old);
}

/**
 * The tree the Conditions tab shows: the person's own, while the stored text
 * is one it wrote (or the text it was edited from, before the write lands),
 * else what the stored text lifts to.
 */
function useConditionTree(nodeId: string, edn: string, lifted: BuilderTree | null) {
  const [held, setHeld] = useState<{
    readonly tree: BuilderTree;
    readonly texts: ReadonlySet<string>;
  } | null>(null);
  const own = held !== null && held.texts.has(edn);
  const tree = own ? held.tree : (lifted ?? []);
  const edit = (next: BuilderTree) => {
    const text = writtenEdn(next);
    setHeld({ tree: next, texts: new Set([...(own ? held.texts : []), edn, text]) });
    // Only a change to what the conditions say writes: a row added and not
    // yet said, or one taken away that said nothing, leaves the text alone,
    // a hand-written one byte for byte.
    if (text !== writtenEdn(tree)) writeQuery(nodeId, text);
  };
  return { tree, edit };
}

function Tab({
  tab,
  selected,
  onSelect,
  children,
}: {
  tab: QueryTab;
  selected: boolean;
  onSelect: (tab: QueryTab) => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-qb-tab={tab}
      className={cn(
        "rounded-sm border px-2 py-px text-label outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary/60",
        selected
          ? "border-foreground/10 bg-foreground/[0.05] text-foreground"
          : "border-transparent text-foreground/45 hover:text-foreground/70",
      )}
      onClick={() => onSelect(tab)}
    >
      {children}
    </button>
  );
}

export interface QueryPanelProps {
  nodeId: string;
  /** The stored `sys.f.query`. */
  edn: string;
  /** What the results read, counted: one answer for both. */
  count: QueryCount;
  depth: number;
  read: GraphRead;
}

/** The Conditions and EDN tabs over a query node's query, with its count. */
export function QueryPanel({ nodeId, edn, count, depth, read }: QueryPanelProps) {
  const reading = readQuery(edn);
  const chosen = useOutlineStore((s) => s.queryTabs[nodeId] ?? "conditions");
  const setQueryTab = useOutlineStore((s) => s.setQueryTab);
  const tab: QueryTab = reading.lifted ? chosen : "edn";
  const { tree, edit } = useConditionTree(nodeId, edn, reading.lifted ? reading.conditions : null);
  const [draft, setDraft] = useState(edn);
  const wireNodes: readonly WireNode[] = usePageGraph((s) => s.wireNodes);
  const node = read.outline.get(nodeId);
  const unparsable = tab === "edn" && draft !== edn && !readsAsEdn(draft);

  return (
    <div
      className="my-1.5 border-l-2 border-foreground/[0.08] pl-3"
      style={indentStyle(depth + 1)}
      data-query-builder={nodeId}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <div role="tablist" aria-label="Query" className="flex items-center gap-0.5">
          {reading.lifted && (
            <Tab
              tab="conditions"
              selected={tab === "conditions"}
              onSelect={(t) => setQueryTab(nodeId, t)}
            >
              Conditions
            </Tab>
          )}
          <Tab tab="edn" selected={tab === "edn"} onSelect={(t) => setQueryTab(nodeId, t)}>
            EDN
          </Tab>
        </div>
        <CountChip count={count} stale={unparsable} />
      </div>
      {tab === "conditions" ? (
        <div role="tabpanel" aria-label="Conditions">
          <ConditionsEditor read={read} wireNodes={wireNodes} tree={tree} edit={edit} />
        </div>
      ) : (
        <div role="tabpanel" aria-label="EDN" className="flex flex-col gap-1.5">
          {!reading.lifted && (
            <p className="text-meta text-warning" data-qb-unlifted="true">
              Can't show as conditions: {reading.reason}.
            </p>
          )}
          <EdnEditor
            value={edn}
            label="Query (EDN)"
            placeholder="[:find ?id :where [?n :node/id ?id] …]"
            onCommit={(text) => writeQuery(nodeId, text)}
            onDraft={setDraft}
          />
          {node !== undefined && (
            <NodeField
              nodeId={nodeId}
              fieldId={SYSTEM_IDS.queryLimitField}
              label="limit"
              values={node.props[SYSTEM_IDS.queryLimitField] ?? []}
              context={read}
              depth={-1}
            />
          )}
        </div>
      )}
    </div>
  );
}
