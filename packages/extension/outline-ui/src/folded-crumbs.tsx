import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  cn,
  MENU_ROW,
  MENU_SURFACE,
  useAnchoredPosition,
  useDismiss,
  useMenuKeys,
} from "@kb/ui-sdk";
import { CRUMB, type Crumb } from "./crumbs";

/**
 * "…": the folded crumbs, named on hover and opened as a menu on click or
 * Enter. Which crumbs are folded is the row's (`useCrumbFolding`), read as
 * the pointer or the menu reaches it.
 */
export function FoldedCrumbs({
  folded,
  onOpen,
}: {
  readonly folded: () => readonly Crumb[];
  readonly onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState<readonly Crumb[] | null>(null);
  const [names, setNames] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        title={names}
        aria-label={names === "" ? "Folded crumbs" : `Folded crumbs: ${names}`}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        className={cn(CRUMB, "shrink-0")}
        onPointerEnter={() => setNames(namesOf(folded()))}
        onFocus={() => setNames(namesOf(folded()))}
        onClick={() => setOpen((was) => (was === null ? folded() : null))}
      >
        …
      </button>
      {open !== null ? (
        <FoldedMenu
          anchor={trigger}
          crumbs={open}
          onClose={() => setOpen(null)}
          onOpen={(id) => {
            setOpen(null);
            onOpen(id);
          }}
        />
      ) : null}
    </>
  );
}

function namesOf(crumbs: readonly Crumb[]): string {
  return crumbs.map((crumb) => crumb.text).join(" › ");
}

function FoldedMenu({
  anchor,
  crumbs,
  onClose,
  onOpen,
}: {
  readonly anchor: React.RefObject<HTMLButtonElement | null>;
  readonly crumbs: readonly Crumb[];
  readonly onClose: () => void;
  readonly onOpen: (id: string) => void;
}) {
  const { ref, onKeyDown } = useMenuKeys();
  const style = useAnchoredPosition(anchor, ref, true);
  // The anchor is its trigger: its click toggles the menu.
  useDismiss(true, { inside: [ref], trigger: anchor }, onClose);
  // It opens with its first row focused, for the arrow keys, once it is
  // placed: a menu not yet placed is hidden, and takes no focus.
  const placed = style !== undefined;
  useLayoutEffect(() => {
    if (placed) ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [placed, ref]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Folded crumbs"
      className={cn(MENU_SURFACE, "z-50")}
      style={style ?? { position: "fixed", visibility: "hidden" }}
      onKeyDown={onKeyDown}
    >
      {crumbs.map((crumb) => (
        <button
          key={crumb.id}
          type="button"
          role="menuitem"
          title={crumb.text}
          className={MENU_ROW}
          onClick={() => onOpen(crumb.id)}
        >
          <span className="truncate">{crumb.text}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
