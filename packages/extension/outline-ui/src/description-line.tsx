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
} from "@kb/ui-sdk";
import { backToRow } from "./back-to-row";
import { doneDescribing, useDescribing, useDescriptionShown } from "./description-state";
import { outlineSource, releaseOutlineKeyboard, useOutlineStore } from "./outline.store";
import { ValueSlot } from "./value-slot";
import { arriveAt, enterFields } from "./value-slot-nav";

const FIELD = SYSTEM_IDS.descriptionField;

/** The keys that end an edit and ask for the row back: Enter keeps it, Escape puts it back. */
const LEAVING_KEYS: ReadonlySet<string> = new Set(["Enter", "Escape"]);

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
  // whatever space it was written with.
  const stored = descriptionValueOf(node);
  const asked = useDescribing((s) => (s.at === instanceKey ? s.gesture : null));
  const { readOnly } = useFieldWrite(nodeId, FIELD, context.schema);
  const shown = useDescriptionShown(nodeId, instanceKey);
  const line = useRef<HTMLDivElement>(null);
  // Whether the last gesture on the line was a key that asks for the row
  // back. An edit that ends because focus went elsewhere leaves it there.
  const keyed = useRef(false);

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
    // The gesture holds the slot until the keyboard leaves it, so a first
    // description keeps its slot, and the keyboard on it, while it is written.
    add: (value) => void writes.updateProp(nodeId, FIELD, value, stored ?? undefined),
    remove: (value) => void writes.removeProp(nodeId, FIELD, value),
    create: () => Promise.resolve(null),
    openPicker: () => undefined,
    addSlot: () => undefined,
    addValue: () => undefined,
    leave: (way) => leave(rowId, instanceKey, line.current, way),
    claimKeyboard: releaseOutlineKeyboard,
    focusSlot: () => undefined,
  };

  return (
    <div
      ref={line}
      // The value's own inset hangs left of the text column, so its first
      // letter starts where the node's text does.
      className="kb-description -ml-1 min-w-0"
      data-description={instanceKey}
      onKeyDownCapture={(e) => {
        keyed.current = LEAVING_KEYS.has(e.key);
      }}
      onPointerDownCapture={() => {
        keyed.current = false;
      }}
      onBlur={() => {
        // Focus left the line: a gesture's empty slot closes with it. The
        // value's editor closing hands focus to its slot only after this
        // blur, so where focus went is read a frame later.
        requestAnimationFrame(() => {
          if (line.current?.contains(document.activeElement) !== true) doneDescribing(instanceKey);
        });
      }}
    >
      {readOnly ? (
        <ReadOnlyDescription text={text ?? ""} />
      ) : (
        <ValueSlot
          value={stored}
          fieldType="text"
          fieldId={FIELD}
          context={context}
          field={field}
          placeholder="Description"
          onFollow={follow}
          onCommit={field.add}
          // Emptied, or left with nothing typed: a stored description is
          // taken out. Left by Enter or Escape, the keyboard goes back to the
          // row as the line leaves, once the slot's own key is done (Escape
          // hands focus back to the slot after its editor closes). Left by
          // focus going elsewhere, focus stays where it went.
          onRemove={() => {
            const back = keyed.current;
            keyed.current = false;
            if (stored !== null) field.remove(stored);
            if (back) queueMicrotask(() => field.leave("back"));
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
