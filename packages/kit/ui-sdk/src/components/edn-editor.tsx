import { useEffect, useRef, useState } from "react";
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
 * when the editor is left or on ⌘↵ (once, and only when it changed), and
 * Escape puts the stored text back and writes nothing. While it is not being edited it follows the
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

  /**
   * Set when a key has ended the edit, so the blur that follows ends nothing:
   * the draft it would read is the render's, not what the key decided.
   */
  const ended = useRef(false);

  /** End the edit: write `text` when it is given and changed; put the stored text back when not. */
  const end = (text: string | null) => {
    ended.current = true;
    setEditing(false);
    if (text === null) setDraft(value);
    else if (text.trim() !== value.trim()) onCommit(text);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <textarea
        value={draft}
        rows={1}
        spellCheck={false}
        aria-label={label}
        placeholder={placeholder}
        className={cn(
          // As tall as the text, wrapped lines included, up to a scroll.
          "max-h-96 w-full [field-sizing:content] resize-y rounded-md bg-foreground/[0.03] px-2 py-1",
          "font-mono text-label leading-[1.5] text-foreground/75 outline-none",
          "placeholder:text-faint-foreground focus:bg-foreground/[0.05]",
          hasText(warning) && "ring-1 ring-warning/40",
        )}
        onFocus={() => {
          ended.current = false;
          setEditing(true);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!ended.current) end(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            end(null);
            e.currentTarget.blur();
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            end(draft);
            e.currentTarget.blur();
          }
        }}
      />
      {hasText(warning) ? <span className="text-label text-warning">{warning}</span> : null}
    </div>
  );
}
