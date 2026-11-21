import { useCallback, useMemo, useState, type ReactNode } from "react";
import { usePickerKeys } from "../lib/use-picker";
import type { PickerRow } from "../lib/picker";
import {
  openTriggerAt,
  refTrigger,
  type OpenTrigger,
  type TextTrigger,
  type TriggerPick,
} from "../lib/text-triggers";
import type { NodeMap } from "../lib/types";
import { PickerList } from "./picker-list";

/** A surface with no triggers of its own. */
const NONE: readonly TextTrigger[] = [];

export interface TextTriggersInput {
  /** The surface's own triggers, beside the `[[` every text has, first open first. */
  readonly own?: readonly TextTrigger[] | undefined;
  /** The text is being edited: a trigger opens only then. */
  readonly editing: boolean;
  /** The text as typed, serialized. */
  readonly text: string;
  /** The caret's offset in `text`. */
  readonly cursor: number;
  readonly nodes: NodeMap;
  /** The row the text is on, and the node whose text it is: neither is offered. */
  readonly nodeId: string;
  readonly textNodeId: string;
  /** What the list is anchored to: the text's element. */
  readonly anchorRef: React.RefObject<HTMLElement | null>;
  /** Lay a pick into the text, over the span its trigger covers. */
  readonly apply: (
    made: TriggerPick | null | Promise<TriggerPick | null>,
    span: OpenTrigger,
  ) => void;
}

export interface TextTriggers {
  /** The trigger open at the caret, and where; null while none is. */
  readonly open: { readonly trigger: TextTrigger; readonly open: OpenTrigger } | null;
  /** A key the open picker takes: true when it took it, so the text must not act on it. */
  readonly keyDown: (e: React.KeyboardEvent) => boolean;
  /** Typing resumed, or the caret was placed anew: a dismissed trigger may open again. */
  readonly resume: () => void;
  /** The picker's list, at the text, while a trigger is open. */
  readonly list: ReactNode;
}

/**
 * The triggers typed in a text (DESIGN-UI.md → Triggers in the text): every
 * text's `[[`, then the surface's own, run with the one picker engine and the
 * one list. Escape dismisses the open one until its query changes or typing
 * resumes (D14), and a trigger with nothing to offer is closed, unless it
 * answers Enter then. What a pick does to the text is the surface's
 * (`apply`): a row's text host writes it as a page write, a value's editor
 * lays it into the value it is editing.
 */
export function useTextTriggers({
  own = NONE,
  editing,
  text,
  cursor,
  nodes,
  nodeId,
  textNodeId,
  anchorRef,
  apply,
}: TextTriggersInput): TextTriggers {
  const triggers = useMemo(() => [refTrigger, ...own], [own]);
  /** The query Escape dismissed the picker at, or null. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const typed = useMemo(() => {
    const at = editing ? openTriggerAt(triggers, text, cursor) : null;
    return at !== null && at.open.query === dismissed ? null : at;
  }, [editing, triggers, text, cursor, dismissed]);
  // Rows exist only while a trigger is typed: a closed text asks for none.
  const rows = useMemo(
    () => (typed === null ? [] : typed.trigger.rows(typed.open.query, nodes, nodeId, textNodeId)),
    [typed, nodes, nodeId, textNodeId],
  );
  const triggered = typed !== null && (rows.length > 0 || typed.trigger.none !== undefined);
  const open = triggered ? typed : null;

  /** A row picked, or (Enter with none) what the trigger does then. */
  const pickRow = (row: PickerRow | null) => {
    if (open === null) return;
    const made = row === null ? open.trigger.none?.(open.open) : open.trigger.pick(row, open.open);
    if (made !== undefined) apply(made, open.open);
  };

  const picker = usePickerKeys({
    rows,
    query: open?.open.query ?? "",
    scope: open?.trigger.id,
    pickOnTab: true,
    onPick: pickRow,
    // D14: Escape dismisses the picker without blurring or leaving edit mode.
    onCancel: () => setDismissed(open?.open.query ?? null),
  });

  const resume = useCallback(() => setDismissed(null), []);

  return {
    open,
    keyDown: (e) => open !== null && picker.handleKeyDown(e),
    resume,
    list:
      open === null ? null : (
        <PickerList
          placement="popover"
          anchorRef={anchorRef}
          rows={rows}
          activeIndex={picker.activeIndex}
          onHover={picker.setActiveIndex}
          onPick={pickRow}
          {...(open.trigger.createLabel === undefined
            ? {}
            : { createLabel: open.trigger.createLabel })}
        />
      ),
  };
}
