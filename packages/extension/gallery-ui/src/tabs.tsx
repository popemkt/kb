import { cn } from "@kb/ui-sdk";

/** A row of tabs: the panes or workflows a page offers, the one shown chosen. */
export function Tabs<T extends string>({
  tabs,
  shown,
  onPick,
  label,
}: {
  readonly tabs: ReadonlyArray<{ readonly id: T; readonly label: string; readonly title?: string }>;
  /** The tab chosen; none while something else stands in for it (an open visual). */
  readonly shown: T | null;
  readonly onPick: (id: T) => void;
  readonly label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={shown === tab.id}
          title={tab.title}
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-meta",
            shown === tab.id
              ? "bg-foreground/10 text-foreground/85"
              : "text-foreground/55 hover:text-foreground/80",
          )}
          onClick={() => onPick(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
