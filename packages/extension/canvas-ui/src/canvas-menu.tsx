/**
 * The canvas's command menus as drawn (the context menu, the zoom menu):
 * rows of the keymap's own commands (`menuCommands`), each with its key,
 * sent through the keymap's applier and closing the menu. Its surface,
 * row and keys are `use-canvas-menu.ts`'s, which the view menu shares;
 * dismissal is `useDismiss`'s, as every popover's.
 */
import { useLayoutEffect, useState, type RefObject } from "react";
import { cn, useDismiss } from "@kb/ui-sdk";
import type { CanvasIntent, CanvasMenuCommand } from "./canvas-keymap";
import { MENU_ROW, MENU_SURFACE, useMenuKeys } from "./use-canvas-menu";

interface Spot {
  readonly x: number;
  readonly y: number;
}

/**
 * `at` moved back inside the element the menu is placed in, so a menu
 * opened near its right or bottom edge is whole; none for a menu placed
 * by its classes.
 */
function useInside(at: Spot | undefined, ref: RefObject<HTMLDivElement | null>) {
  const [inside, setInside] = useState(at);
  useLayoutEffect(() => {
    const menu = ref.current;
    const stage = menu?.offsetParent;
    if (at === undefined || !menu || !(stage instanceof HTMLElement)) return setInside(at);
    const x = Math.max(4, Math.min(at.x, stage.clientWidth - menu.offsetWidth - 4));
    const y = Math.max(4, Math.min(at.y, stage.clientHeight - menu.offsetHeight - 4));
    setInside({ x, y });
  }, [at, ref]);
  return inside === undefined ? undefined : { left: inside.x, top: inside.y };
}

/** A rule between a menu's kinds of row. */
export function MenuSeparator() {
  return <div role="separator" className="mx-1 my-1 h-px bg-foreground/10" />;
}

/** A row's key, right-aligned, in words (`CanvasShortcut.hint`); nothing for none. */
export function MenuHint({ hint }: { hint: string }) {
  if (hint === "") return null;
  return <kbd className="ml-auto font-mono text-label text-foreground/35">{hint}</kbd>;
}

/** An open command menu: `rows` of commands, a rule between rows, the first focused. */
export function CommandMenu({
  rows,
  at,
  trigger,
  label,
  testId,
  className,
  onIntent,
  onClose,
}: {
  rows: readonly (readonly CanvasMenuCommand[])[];
  /** Where it opens in the element it is placed in, kept inside it; none to be placed by `className`. */
  at?: Spot;
  /** The button that opened it, whose own click toggles it; none for a right-click's. */
  trigger: RefObject<HTMLElement | null> | null;
  label: string;
  testId: string;
  className: string;
  onIntent: (intent: CanvasIntent) => void;
  onClose: () => void;
}) {
  const { ref, onKeyDown } = useMenuKeys();
  useDismiss(true, { inside: [ref], trigger }, onClose);
  const style = useInside(at, ref);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-testid={testId}
      className={cn(MENU_SURFACE, className)}
      style={style}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {rows.map((row, r) => (
        <div key={row[0]?.label} role="group">
          {r > 0 && <MenuSeparator />}
          {row.map((command, c) => (
            <button
              key={command.label}
              type="button"
              role="menuitem"
              // The menu opens with its first row focused, for the arrow keys.
              autoFocus={r === 0 && c === 0}
              className={cn(MENU_ROW, "text-foreground/80")}
              onClick={() => {
                onClose();
                onIntent(command.intent);
              }}
            >
              <span className="truncate">{command.label}</span>
              <MenuHint hint={command.hint} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
