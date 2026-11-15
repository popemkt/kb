/**
 * "+ Add" where a collection view's rows are (DESIGN-UI.md → Adding to a
 * frame): the view says what the row holds there, its filter and a group's
 * value, and its host makes it (`FrameSubject.addRow`).
 */
import { Button, type FrameSubject, type RowCondition } from "@kb/ui-sdk";
import type { ViewFilter } from "@kb/views";

/** No conditions beyond the view's filter. */
const NOTHING: readonly RowCondition[] = [];

/** The button, named for where it adds ("Add to Doing"). */
export function AddRow({
  frame,
  filters,
  where = NOTHING,
  label,
}: {
  readonly frame: FrameSubject;
  /** The view's filter, which every row it adds holds. */
  readonly filters: readonly ViewFilter[];
  readonly where?: readonly RowCondition[];
  readonly label: string;
}) {
  return (
    <Button
      variant="ghost"
      className="w-full text-left text-meta font-normal text-foreground/50"
      data-add-row={frame.frameId}
      aria-label={label}
      onClick={() => frame.addRow([...filters, ...where])}
    >
      + Add
    </Button>
  );
}
