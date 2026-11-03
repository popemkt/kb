import type { CalendarEntry } from "@kb/routines";
import { BUTTON_CLASS, Dialog, PRIMARY_BUTTON_CLASS } from "./dialog";

/** A repeating instance dragged somewhere: move just this one, or every one of its series? */
export function ScopePrompt({
  entry,
  onChoose,
  onCancel,
}: {
  readonly entry: CalendarEntry;
  readonly onChoose: (scope: "one" | "series") => void;
  readonly onCancel: () => void;
}) {
  return (
    <Dialog
      title={`Move “${entry.title === "" ? "Untitled" : entry.title}”`}
      onClose={onCancel}
      testId="scope-prompt"
    >
      <p className="text-ui text-muted-foreground">
        It repeats. Move just this one, or the whole series?
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BUTTON_CLASS} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={BUTTON_CLASS} onClick={() => onChoose("series")}>
          The whole series
        </button>
        <button
          type="button"
          autoFocus
          className={PRIMARY_BUTTON_CLASS}
          onClick={() => onChoose("one")}
        >
          Just this one
        </button>
      </div>
    </Dialog>
  );
}
