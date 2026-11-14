/**
 * Triggers in the text (DESIGN-UI.md → Triggers in the text): what typing
 * `[[` opens at the caret. Each trigger
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

/** What a pick does: the text that replaces the trigger's span, then any write. */
export interface TriggerPick {
  readonly insert: string;
  /** A write made once the text is in place. */
  readonly write?: () => Promise<void>;
}

export interface TextTrigger {
  readonly id: string;
  /** The trigger typed before `cursor` in `text`, if one is. */
  readonly open: (text: string, cursor: number) => OpenTrigger | null;
  /** What it offers for `query`, read from `nodes`. */
  readonly rows: (query: string, nodes: NodeMap) => PickerRow[];
  /** A row picked (by Enter, Tab or a click). */
  readonly pick: (row: PickerRow, open: OpenTrigger) => TriggerPick | Promise<TriggerPick>;
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
 * `[[`: a reference to any node. A pick inserts `[[id|label]]`; Enter with
 * nothing to pick closes the brackets.
 */
export const refTrigger: TextTrigger = {
  id: "ref",
  open: (text, cursor) => {
    const open = openRefQuery(text, cursor);
    return open === null ? null : { start: open.start, end: cursor, query: open.query };
  },
  rows: (query, nodes) => pickerRows(nodeCandidates(nodes), { query, limit: ROW_LIMIT }),
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
