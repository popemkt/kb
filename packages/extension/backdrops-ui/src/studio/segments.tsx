/**
 * The studio's segmented switch: one of a few, each a button that says
 * whether it is the one shown (the variant, the strength).
 */
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
