/**
 * A tag's box on its row (DESIGN-UI.md → A tag's box). It is drawn from
 * the field it is tied to (`checkOf`) and holds no state of its own, and
 * pressing it toggles that field through the row's one write
 * (`toggleRowChecks`), as ⌘Enter does. Focused, it answers its own keys, and
 * Escape goes back to its row, selected.
 */
import { CheckMark } from "./check-mark";
import { toggleRowChecks } from "./editing-writes";
import { backToRow } from "./back-to-row";
import type { RowCheckState } from "./row-check-state";

/**
 * The box of the row `nodeId`, as its tag names it (`rowCheckOf`): the
 * row's lead mark (`NodeRow`'s `lead`), drawn only where a tag names one.
 */
export function RowCheck({
  nodeId,
  instanceKey,
  check,
}: {
  /** The row's node: its box is the node its text is (`toggleRowChecks`). */
  nodeId: string;
  /** The row instance Escape goes back to. */
  instanceKey: string;
  check: RowCheckState;
}) {
  const { checked, label } = check;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      data-row-check={checked ? "checked" : "unchecked"}
      className="group/check flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      // The box is not the text: pressing it leaves focus and the caret where they were.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        void toggleRowChecks([nodeId]);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        backToRow(e.currentTarget, nodeId, instanceKey);
      }}
    >
      <CheckMark checked={checked} />
    </button>
  );
}
