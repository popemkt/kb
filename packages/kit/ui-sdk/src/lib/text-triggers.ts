/**
 * Triggers in the text (DESIGN-UI.md → Triggers in the text): what typing
 * `[[` (and the outline's `@`, `#` and `>`) opens at the caret. Each trigger
 * says where it opens in the text, what it offers there, and what a pick
 * does; the text host runs them all with the one picker engine
 * (`lib/picker`, `usePickerKeys`) and the one list.
 */
import { formatRefToken, nodeCandidates, openRefQuery } from "./refs";
import { pickerRows, type PickerRow } from "./picker";
import type { NodeMap } from "./types";

/** A trigger typed at the caret: the span it covers in the text, and its query. */
export interface OpenTrigger {
  /** Where its opener starts. */
  readonly start: number;
  /** Where it ends: the caret it was read at. */
  readonly end: number;
  /** What was typed after the opener. */
  readonly query: string;
}

/** A pick edits its span or consumes the row in a graph write. */
export type TriggerPick =
  | {
      readonly insert: string;
      /** A write made once the text is in place. */
      readonly write?: () => Promise<void>;
    }
  | {
      /** Owns the row's removal and the focus after the write lands. */
      readonly consume: () => Promise<void>;
    };

export interface TextTrigger {
  readonly id: string;
  /** The trigger typed before `cursor` in `text`, if one is. */
  readonly open: (text: string, cursor: number) => OpenTrigger | null;
  /** What it offers for `query`, given the row and the node whose text it shows when known. */
  readonly rows: (
    query: string,
    nodes: NodeMap,
    nodeId?: string,
    textNodeId?: string,
  ) => PickerRow[];
  /** How a row that makes a new node by the query's name reads ("Create tag “x”"). */
  readonly createLabel?: (name: string) => string;
  /** A row picked (by Enter, Tab or a click). */
  readonly pick: (
    row: PickerRow,
    open: OpenTrigger,
  ) => TriggerPick | null | Promise<TriggerPick | null>;
  /**
   * Enter or Tab with nothing to pick. A trigger that answers it stays open
   * with no rows; one that does not is closed then, and its keys are the
   * text's.
   */
  readonly none?: (open: OpenTrigger) => TriggerPick;
}

/** How many rows the text's pickers show. */
const ROW_LIMIT = 12;

/**
 * `[[`: a reference to another node. A pick inserts `[[id|label]]`; Enter with
 * nothing to pick closes the brackets.
 */
export const refTrigger: TextTrigger = {
  id: "ref",
  open: (text, cursor) => {
    const open = openRefQuery(text, cursor);
    return open === null ? null : { start: open.start, end: cursor, query: open.query };
  },
  rows: (query, nodes, nodeId, textNodeId) =>
    pickerRows(nodeCandidates(nodes, { exclude: (id) => id === nodeId || id === textNodeId }), {
      query,
      limit: ROW_LIMIT,
    }),
  pick: (row) => ({ insert: formatRefToken(row.id, row.kind === "item" ? row.label : row.name) }),
  none: (open) => ({ insert: `[[${open.query}]]` }),
};

/** The first trigger open at `cursor` in `text`, and where. */
export function openTriggerAt(
  triggers: readonly TextTrigger[],
  text: string,
  cursor: number,
): { readonly trigger: TextTrigger; readonly open: OpenTrigger } | null {
  for (const trigger of triggers) {
    const open = trigger.open(text, cursor);
    if (open !== null) return { trigger, open };
  }
  return null;
}
