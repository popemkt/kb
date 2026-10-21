import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { hasText } from "../lib/text";

export interface EdnEditorProps {
  /** The stored EDN. */
  value: string;
  /** Write `text`, as typed: it differs from the stored value. */
  onCommit: (text: string) => void;
  /** The textarea's accessible name. */
  label: string;
  placeholder?: string;
  /** What is wrong with the stored value, shown under it. */
  warning?: string;
  /** What the textarea holds now, on every change and when it is reset to `value`. */
  onDraft?: (draft: string) => void;
}

/**
 * The one EDN text editor: a plain monospace textarea over a stored query.
 * kb has no code editor component, and adding one is its own decision.
 *
 * It edits a draft, never the store: the stored text is written as typed
 * when the editor is left or on ⌘↵ (and only when it changed), and Escape
 * puts the stored text back. While it is not being edited it follows the
 * stored value, so a write from elsewhere shows.
 */
export function EdnEditor({
  value,
  onCommit,
  label,
  placeholder,
  warning,
  onDraft,
}: EdnEditorProps) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    onDraft?.(draft);
  }, [draft, onDraft]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() === value.trim()) return;
    onCommit(draft);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <textarea
        value={draft}
        rows={draft.includes("\n") ? 3 : 1}
        spellCheck={false}
        aria-label={label}
        placeholder={placeholder}
        className={cn(
          "w-full resize-y rounded-md bg-foreground/[0.03] px-2 py-1",
          "font-mono text-label leading-[1.5] text-foreground/75 outline-none",
          "placeholder:text-foreground/25 focus:bg-foreground/[0.05]",
          hasText(warning) && "ring-1 ring-warning/40",
        )}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
            e.currentTarget.blur();
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          }
        }}
      />
      {hasText(warning) ? <span className="text-label text-warning">{warning}</span> : null}
    </div>
  );
}
