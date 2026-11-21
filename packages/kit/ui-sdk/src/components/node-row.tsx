import { useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import { asInstance } from "../lib/dom";
import { menuAnchor } from "../lib/menu-anchor";
import { OutlineLine } from "./outline-line";

export interface NodeRowProps {
  depth: number;
  isSelected?: boolean;
  /**
   * A row of a range of several selected rows, the head among them
   * (DESIGN-UI.md → Outline editor, "A selection is a range of rows"):
   * drawn selected, square where it meets its neighbours so the range reads
   * as one band. The focus stays on the head (`isSelected`).
   */
  inRange?: boolean;
  isActive?: boolean;
  /**
   * Row activation — click or Enter/Space. `SyntheticEvent`, not
   * `MouseEvent`: the keyboard path is the same activation, and the only
   * caller that reads the event asks `target === currentTarget`.
   */
  onRowClick?: (e: React.SyntheticEvent) => void;
  bullet: React.ReactNode;
  /**
   * The row's one lead mark, a tag's box (`OutlineLine`'s `lead`): drawn
   * after the bullet, and the text starts one step further in.
   */
  lead?: React.ReactNode;
  /** Full node-content area (text + optional trailing chips). */
  content: React.ReactNode;
  /**
   * What the row says under its text, on the same text column: the node's
   * description (DESIGN-UI.md → Outline editor, "A node's description").
   */
  subtitle?: React.ReactNode;
  className?: string;
  nodeId?: string;
  /** Render-instance key when the same nodeId appears more than once. */
  instanceKey?: string;
}

const ROW_SELECTOR = '[data-node-row="true"]';

/**
 * What a row says of itself: selected (the head, or a row of the range),
 * edited, and, when it can be activated, its tree role and whether Tab
 * reaches it (the head and the row being edited only).
 */
function rowState(interactive: boolean, head: boolean, inRange: boolean, active: boolean) {
  return {
    "data-selected": head || inRange ? "true" : undefined,
    "data-active": active ? "true" : undefined,
    role: interactive ? "treeitem" : undefined,
    "aria-selected": interactive ? head || inRange || active : undefined,
    tabIndex: interactive ? (head || active ? 0 : -1) : undefined,
  };
}

/** Enter and Space activate the row, unless a nested editor or button is where they were pressed. */
function activatedByKeys(
  onRowClick: (e: React.SyntheticEvent) => void,
): (e: React.KeyboardEvent) => void {
  return (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // Don't steal keys from nested editors / buttons.
    const t = asInstance(e.target, HTMLElement);
    if (
      t !== undefined &&
      (t.isContentEditable ||
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "BUTTON" ||
        t.closest("button,[contenteditable='true'],input,textarea") !== null)
    ) {
      return;
    }
    e.preventDefault();
    onRowClick(e);
  };
}

/** DESIGN-RESKIN §1.3 — the one node row everywhere. */
export function NodeRow({
  depth,
  isSelected = false,
  inRange = false,
  isActive = false,
  onRowClick,
  bullet,
  lead,
  content,
  subtitle,
  className,
  nodeId,
  instanceKey,
}: NodeRowProps) {
  const interactive = Boolean(onRowClick);
  const ref = useRef<HTMLDivElement>(null);
  const holdsSelection = interactive && isSelected && !isActive;
  const drawnSelected = (isSelected || inRange) && !isActive;
  // Focus follows the selection. A row that becomes selected — Escape out of
  // its editor, arrow navigation, a zoom — takes focus when it would otherwise
  // fall to <body>, is still inside the row, or sits on the row the selection
  // just left (which would keep answering Enter and Space), so Tab and screen
  // readers stay on the selected row. It never takes focus from anything else
  // (a palette, an input elsewhere, another row's editor).
  useEffect(() => {
    const el = ref.current;
    if (!holdsSelection || el === null) return;
    const focused = el.ownerDocument.activeElement;
    const onRow = focused?.matches(ROW_SELECTOR) === true;
    if (focused === null || focused === el.ownerDocument.body || el.contains(focused) || onRow) {
      el.focus({ preventScroll: true });
    }
  }, [holdsSelection]);
  return (
    <OutlineLine
      ref={ref}
      depth={depth}
      glyph={bullet}
      lead={lead}
      text={
        <>
          <div className="node-content flex min-h-6 items-start gap-1.5 rounded-sm pr-1">
            {content}
          </div>
          {subtitle}
        </>
      }
      className={cn(
        "node-row group/node",
        "rounded-sm transition-colors duration-75",
        // One surface: the row's box holds the tint, bullet and text alike,
        // and the focus ring is drawn on the same box.
        drawnSelected && "bg-primary/8",
        inRange && "rounded-none",
        interactive &&
          "outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        className,
      )}
      style={{ minHeight: "var(--kb-row-h)" }}
      data-node-id={nodeId}
      data-instance-key={instanceKey}
      {...(instanceKey === undefined ? {} : menuAnchor(instanceKey))}
      data-node-row="true"
      {...rowState(interactive, isSelected, inRange, isActive)}
      onClick={onRowClick}
      onKeyDown={onRowClick === undefined ? undefined : activatedByKeys(onRowClick)}
    />
  );
}
