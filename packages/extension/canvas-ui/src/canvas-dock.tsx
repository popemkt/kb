/**
 * The canvas's dock (DESIGN-UI.md → Canvas → The dock): the column down the
 * stage's right edge where its panels stand, always in the same place and
 * never anchored to what they are about, so none covers the selection it
 * edits. The view widget heads it; under it, the style panel of what is
 * selected (`ItemInspector`, `EdgeInspector`) and the comments list. Each
 * panel is as tall as its rows, and the column scrolls a panel inside
 * itself rather than letting it run off the stage.
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { cn } from "@kb/ui-sdk";
import { DOCK_PANEL_WIDTH } from "./canvas-dock-size";

/**
 * What the dock remembers while it is up, by name: which panels are folded
 * and whether More is open, so each stays as it was left from one
 * selection to the next.
 */
const DockFlags = createContext<{
  readonly on: ReadonlySet<string>;
  readonly set: (flag: string, on: boolean) => void;
}>({ on: new Set(), set: () => {} });

function useDockFlag(flag: string): [boolean, (on: boolean) => void] {
  const flags = useContext(DockFlags);
  return [flags.on.has(flag), (on) => flags.set(flag, on)];
}

/** The column: its head (the comments switch and the view widget) at the top, then its panels. */
export function CanvasDock({
  head,
  children,
}: {
  readonly head: ReactNode;
  readonly children: ReactNode;
}) {
  const [on, setOn] = useState<ReadonlySet<string>>(new Set());
  const flags = useMemo(
    () => ({
      on,
      set: (flag: string, value: boolean) =>
        setOn((current) => {
          const next = new Set(current);
          if (value) next.add(flag);
          else next.delete(flag);
          return next;
        }),
    }),
    [on],
  );
  return (
    <DockFlags.Provider value={flags}>
      <div
        className="pointer-events-none absolute top-3 right-3 bottom-3 z-30 flex flex-col items-end gap-2"
        data-testid="canvas-dock"
      >
        <div className="pointer-events-auto flex items-start gap-2">{head}</div>
        {children}
      </div>
    </DockFlags.Provider>
  );
}

/**
 * One panel of the dock: a titled card as tall as what it holds, scrolled
 * inside once the column has no more room, and folded to its title by the
 * caret at its right. `name` is what the dock remembers it by.
 */
export function DockPanel({
  name,
  title,
  aside,
  children,
  className,
  "data-testid": testId,
}: {
  readonly name: string;
  readonly title: ReactNode;
  /** What stands at the right of its title: a count, a filter. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly "data-testid"?: string;
}) {
  const [folded, setFolded] = useDockFlag(`folded:${name}`);
  return (
    <section
      aria-label={name}
      data-testid={testId}
      style={{ width: DOCK_PANEL_WIDTH }}
      className={cn(
        "pointer-events-auto flex min-h-0 shrink flex-col rounded-lg border border-foreground/10 bg-popover/95 shadow-floating backdrop-blur-sm",
        className,
      )}
    >
      <header className="flex h-7 shrink-0 items-center gap-1 pr-1 pl-2.5">
        <h2 className="min-w-0 flex-1 truncate text-label tracking-wide text-foreground/40 uppercase">
          {title}
        </h2>
        {aside}
        <DockPick
          aria-expanded={!folded}
          aria-label={folded ? `Show ${name}` : `Fold ${name}`}
          title={folded ? "Show" : "Fold"}
          className="flex h-5 w-5 items-center justify-center rounded-sm text-foreground/40 hover:bg-foreground/5 hover:text-foreground/75"
          onClick={() => setFolded(!folded)}
        >
          <CaretDownIcon
            size={11}
            className={cn("transition-transform", !folded && "rotate-180")}
          />
        </DockPick>
      </header>
      {!folded && <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">{children}</div>}
    </section>
  );
}

/** A section of a panel, under a hairline: the rows of one concern. */
export function DockSection({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-foreground/[0.06] px-2 py-1.5">
      {children}
    </div>
  );
}

/**
 * A panel's rarer rows behind a disclosure, closed until opened; it stays as
 * it was left while the dock is up, from one selection to the next.
 */
export function DockMore({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useDockFlag("more");
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group border-t border-foreground/[0.06]"
    >
      <summary
        className="flex h-7 cursor-default list-none items-center justify-between px-2.5 text-label text-foreground/45 hover:text-foreground/75 [&::-webkit-details-marker]:hidden"
        // The disclosure keeps the keyboard where it was, as a pick does.
        onPointerDown={(e) => e.preventDefault()}
      >
        More
        <CaretDownIcon size={11} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col pb-1">{children}</div>
    </details>
  );
}

/**
 * A pick in the dock: a button whose press keeps the focus where it was —
 * on the canvas, whose shortcuts (Space, the arrows, Delete) then still
 * reach it — so a pick never takes the keyboard.
 */
export function DockPick(props: Omit<ComponentProps<"button">, "type" | "onPointerDown">) {
  return <button type="button" onPointerDown={(e) => e.preventDefault()} {...props} />;
}

/** One choice of an icon row: its value, its name, and how it is drawn. */
export interface IconChoice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon: ReactNode;
}

/** How many picks a row lays across: up to four, or six in one row of narrow ones; five wrap as four. */
const COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  6: "grid-cols-6",
};

/** A look's choices as a row of icons, the one chosen lit: a pick is one change. */
export function IconRow<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly choices: readonly IconChoice<T>[];
  readonly onChange: (next: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={`look-${label.toLowerCase()}`}
      className={cn("grid gap-0.5", COLUMNS[Math.min(choices.length, 6)] ?? "grid-cols-4")}
    >
      {choices.map((choice) => (
        <DockPick
          key={choice.value}
          role="radio"
          aria-checked={choice.value === value}
          aria-label={`${label}: ${choice.label}`}
          title={`${label}: ${choice.label}`}
          className={cn(
            "flex h-7 items-center justify-center rounded-md text-foreground/60",
            choice.value === value
              ? "bg-foreground/[0.08] text-foreground"
              : "hover:bg-foreground/5 hover:text-foreground/85",
          )}
          onClick={() => onChange(choice.value)}
        >
          {choice.icon}
        </DockPick>
      ))}
    </div>
  );
}
