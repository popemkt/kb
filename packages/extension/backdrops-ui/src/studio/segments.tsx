/**
 * The studio's controls: a segmented switch, one of a few, each a button
 * that says whether it is the one shown (the variant, the strength, the
 * preview); and a tool button, one press, or a switch held on.
 */
import type { ReactNode } from "react";
import { cn } from "@kb/ui-sdk";

const SEGMENT =
  "flex h-6 items-center rounded-md px-2 text-meta transition-colors duration-100 focus-visible:outline focus-visible:outline-primary";
const segment = (on: boolean) =>
  cn(
    SEGMENT,
    on
      ? "bg-foreground/[0.08] text-foreground/80"
      : "text-foreground/45 hover:bg-foreground/[0.05] hover:text-foreground/70",
  );

export function Segments<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { readonly id: T; readonly label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          className={segment(option.id === value)}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** One of the studio's tools: a press (`onClick`), or a switch when it says whether it is on (`pressed`). */
export function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  /** What it does, for a screen reader and the tooltip. */
  readonly label: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={cn(
        segment(pressed === true),
        "gap-1 disabled:opacity-35 disabled:hover:bg-transparent",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
