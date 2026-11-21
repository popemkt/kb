/**
 * A node's description under its name (DESIGN-UI.md → Outline editor, "A
 * node's description"; DESIGN.md → Data model → descriptions): the node's
 * `sys.f.description` value, a step smaller and muted, on the text column
 * of a row or of the page's title.
 *
 * It is that field's value slot (`ValueSlot`), drawn here rather than as a
 * field row, so a click, Enter or F2 edits it with the text value's own
 * editor, Escape goes back to the row, and an emptied description is a
 * value taken out. A node with none draws nothing until a gesture opens its
 * slot (`describe`): then it opens empty and editing, and leaving it empty
 * leaves nothing behind.
 */
import { useLayoutEffect, useRef } from "react";
import { descriptionOf, descriptionValueOf, SYSTEM_IDS } from "@kb/model";
import {
  browserHost,
  rowTextOf,
  useFieldWrite,
  useFollow,
  useGraphRead,
  type FieldHandle,
  type PropValue,
} from "@kb/ui-sdk";
import { backToRow } from "./back-to-row";
import { doneDescribing, useDescribing, useDescriptionShown } from "./description-state";
import { outlineSource, releaseOutlineKeyboard, useOutlineStore } from "./outline.store";
import { ValueSlot } from "./value-slot";
import { arriveAt, enterFields } from "./value-slot-nav";

const FIELD = SYSTEM_IDS.descriptionField;

/** Where the keyboard goes when it leaves the description: back to the row, its text, or on. */
function leave(
  rowId: string,
  instanceKey: string,
  from: Element | null,
  way: "up" | "down" | "back",
) {
  doneDescribing(instanceKey);
  const s = useOutlineStore.getState();
  if (way === "back") backToRow(from, rowId, instanceKey);
  else if (way === "up")
    s.activateNode(rowId, rowTextOf(outlineSource(), rowId).text.length, instanceKey);
  else if (!enterFields(instanceKey, "first")) {
    const next = s.getNextVisibleInstance(instanceKey);
    if (next !== null) s.activateNode(next.nodeId, 0, next.instanceKey);
  }
}

export function DescriptionLine({
  rowId,
  nodeId,
  instanceKey,
}: {
  /** The row the line is drawn in: where the keyboard goes back to. */
  readonly rowId: string;
  /** The node whose description it is: the row's shown node. */
  readonly nodeId: string;
  /** The row instance, or the page's title, it is drawn under. */
  readonly instanceKey: string;
}) {
  const context = useGraphRead();
  const follow = useFollow();
  const node = context.schema.get(nodeId);
  const text = descriptionOf(node);
  // The value as stored, so an edit replaces it and a removal takes it out
  // whatever space it was written with; the slot shows it trimmed, as every
  // other surface does.
  const stored = descriptionValueOf(node);
  const drawn: PropValue | null = text === null ? null : { t: "str", v: text };
  const asked = useDescribing((s) => (s.at === instanceKey ? s.gesture : null));
  const { readOnly } = useFieldWrite(nodeId, FIELD, context.schema);
  const shown = useDescriptionShown(nodeId, instanceKey);
  const line = useRef<HTMLDivElement>(null);

  // A gesture asked for it: its slot opens for editing, once it is drawn.
  useLayoutEffect(() => {
    const slot = line.current?.querySelector("[data-value-slot]");
    if (asked !== null && slot !== null && slot !== undefined) arriveAt(slot, "edit");
  }, [asked]);

  if (!shown) return null;
  const { writes } = browserHost();
  const field: FieldHandle = {
    holder: nodeId,
    values: stored === null ? [] : [stored],
    many: false,
    // The gesture holds the slot until it is left empty, so a first
    // description keeps its slot, and the keyboard on it, while it is written.
    add: (value) => void writes.updateProp(nodeId, FIELD, value, stored ?? undefined),
    remove: (value) => void writes.removeProp(nodeId, FIELD, value),
    create: () => Promise.resolve(null),
    openPicker: () => undefined,
    addSlot: () => undefined,
    addValue: () => undefined,
    leave: (way) => leave(rowId, instanceKey, line.current, way),
    claimKeyboard: releaseOutlineKeyboard,
    // The line holds one value: a written description is its one slot, at rest.
    focusSlot: () => {
      const slot = line.current?.querySelector("[data-value-slot]");
      if (slot !== null && slot !== undefined) arriveAt(slot, "rest");
    },
  };

  return (
    <div
      ref={line}
      // The value's own inset hangs left of the text column, so its first
      // letter starts where the node's text does.
      className="kb-description -ml-1 min-w-0"
      data-description={instanceKey}
    >
      {readOnly ? (
        <ReadOnlyDescription text={text ?? ""} />
      ) : (
        <ValueSlot
          value={drawn}
          fieldType="text"
          fieldId={FIELD}
          context={context}
          field={field}
          placeholder="Description"
          onFollow={follow}
          onCommit={field.add}
          // Emptied, or left with nothing typed: the gesture is over and a
          // stored description is taken out, so the line leaves. Where the
          // keyboard goes is the slot's: the key that ended the edit sends it
          // on (`field.leave`), and focus that went elsewhere stays there.
          onRemove={() => {
            doneDescribing(instanceKey);
            if (stored !== null) field.remove(stored);
          }}
        />
      )}
    </div>
  );
}

/** A description no one here may write (a system node's), drawn as words. */
function ReadOnlyDescription({ text }: { readonly text: string }) {
  return <div className="kb-text kb-text-row px-1 text-foreground/70">{text}</div>;
}
