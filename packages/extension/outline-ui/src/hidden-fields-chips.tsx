/**
 * A node's hidden fields, as one line of chips after its rows (DESIGN-UI.md
 * → Field values → hidden fields chips): each chip names a field its show
 * keeps off the rows, so the name is in view without a click, and one
 * trailing "…" stands for the tucked ones.
 *
 * The line is one stop in the values' keyboard path (`registerSlot`): ↑/↓
 * arrive on it and leave it as they do a value, ←/→ walk its chips, and
 * Escape hands the keyboard back to the row. Which chip the keyboard stands
 * on, and whether "…" is expanded, are this drawn line's passing state.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { DotsThreeIcon, type Icon } from "@phosphor-icons/react";
import { cn, indentStyle, resolveFieldTypeById, type SchemaIndex } from "@kb/ui-sdk";
import { useSlotKind } from "./slot-kind";
import { arriveAt, neighbourSlot, registerSlot } from "./value-slot-nav";

/** A field the line draws as a chip: its id and its name. */
interface ChipField {
  readonly fieldId: string;
  readonly fieldName: string;
}

interface HiddenFieldsChipsProps {
  /** The fields drawn as chips, in the node's order. */
  chips: readonly ChipField[];
  /** The fields behind "…", in the node's order. */
  tucked: readonly ChipField[];
  depth: number;
  schema: SchemaIndex;
  /** A field whose chip takes the keyboard once drawn: one just closed back into the line. */
  landing: string | null;
  /** The landing was made (or its chip is gone). */
  onLanded: () => void;
  /** Open a chip's field as a row. */
  onOpen: (fieldId: string) => void;
  /** Out of the line, to the row: up, down, or back. */
  onLeave: (way: "up" | "down" | "back") => void;
}

/**
 * The chip classes: a pill of the secondary rows' muted small text, 20px
 * tall and centred in the row's 24px line, so a line of chips is as tall as
 * a field row and reads as something to open rather than as a row.
 */
const CHIP = cn(
  "my-0.5 flex h-5 shrink-0 items-center rounded-md pr-2 whitespace-nowrap touch-manipulation",
  "bg-foreground/5 text-meta leading-none text-muted-foreground",
  "hover:bg-foreground/10 hover:text-foreground",
  "transition-colors duration-100 motion-reduce:transition-none",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
);

/** The keys that walk the line's chips, and the keys that leave it, by direction. */
const STEPS: Readonly<Partial<Record<string, -1 | 1>>> = { ArrowLeft: -1, ArrowRight: 1 };
const LEAVES: Readonly<Partial<Record<string, -1 | 1>>> = { ArrowUp: -1, ArrowDown: 1 };

/** "N more fields": the name "…" is read by. */
function moreLabel(count: number): string {
  return `${count} more ${count === 1 ? "field" : "fields"}`;
}

export function HiddenFieldsChips({
  chips,
  tucked,
  depth,
  schema,
  landing,
  onLanded,
  onOpen,
  onLeave,
}: HiddenFieldsChipsProps) {
  const [expanded, setExpanded] = useState(false);
  /** The chip the keyboard stands on, by place: the line's one tab stop. */
  const [active, setActive] = useState(0);
  const line = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const shown = expanded ? [...chips, ...tucked] : chips;
  const more = !expanded && tucked.length > 0;
  const count = shown.length + (more ? 1 : 0);
  const current = Math.min(active, count - 1);

  /** Put the keyboard on the chip at `index`. */
  const focusAt = (index: number) => {
    setActive(index);
    buttons.current[index]?.focus();
  };
  const focusCurrent = useRef(() => {});
  useLayoutEffect(() => {
    focusCurrent.current = () => focusAt(current);
  });

  useLayoutEffect(() => {
    const el = line.current;
    if (el === null) return undefined;
    const focus = () => focusCurrent.current();
    // The line holds no value to edit or add to: every arrival is the chip.
    return registerSlot(el, { focus, editAtEnd: focus, add: focus });
  }, []);

  /** A chip the keyboard goes to once the line redraws, by place: the first tucked one, expanded. */
  const arriving = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (arriving.current !== null) {
      focusAt(arriving.current);
      arriving.current = null;
    }
    if (landing === null) return;
    const at = shown.findIndex((chip) => chip.fieldId === landing);
    // A tucked field closed while "…" is folded lands on "…".
    focusAt(at === -1 ? count - 1 : at);
    onLanded();
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = STEPS[e.key];
    const leave = LEAVES[e.key];
    if (step === undefined && leave === undefined && e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (step !== undefined) focusAt(Math.max(0, Math.min(count - 1, current + step)));
    else if (leave === undefined) onLeave("back");
    else {
      const neighbour = line.current === null ? null : neighbourSlot(line.current, leave);
      if (neighbour !== null) arriveAt(neighbour, "rest");
      else onLeave(leave === -1 ? "up" : "down");
    }
  };

  const names = shown.map((chip) => chip.fieldName);
  return (
    <div
      ref={line}
      role="group"
      aria-label={names.length > 0 ? `Hidden fields: ${names.join(", ")}` : "Hidden fields"}
      data-value-slot="true"
      data-hidden-fields={names.length}
      className="flex flex-wrap items-start gap-x-1.5 border-y border-transparent py-1"
      // A field row's geometry (FieldRow): the first chip's icon in the
      // glyph column, its name where field labels start.
      style={indentStyle(depth + 1)}
    >
      {shown.map((chip, i) => (
        <FieldChip
          key={chip.fieldId}
          chip={chip}
          schema={schema}
          tabIndex={i === current ? 0 : -1}
          buttonRef={(el) => {
            buttons.current[i] = el;
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setActive(i)}
          onOpen={() => onOpen(chip.fieldId)}
        />
      ))}
      {more && (
        <MoreChip
          count={tucked.length}
          tabIndex={current === shown.length ? 0 : -1}
          buttonRef={(el) => {
            buttons.current[shown.length] = el;
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setActive(shown.length)}
          onExpand={() => {
            setExpanded(true);
            // The keyboard goes on to the first tucked field, now in its place.
            arriving.current = chips.length;
          }}
        />
      )}
    </div>
  );
}

/** The tucked fields' one chip, "…", named by how many it stands for. */
function MoreChip({
  count,
  tabIndex,
  buttonRef,
  onKeyDown,
  onFocus,
  onExpand,
}: {
  count: number;
  tabIndex: number;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onFocus: () => void;
  onExpand: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      // Its glyph box alone, so the pill is square around "…".
      className={cn(CHIP, "pr-0")}
      tabIndex={tabIndex}
      aria-label={moreLabel(count)}
      title={moreLabel(count)}
      data-tucked-fields={count}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onClick={(e) => {
        e.stopPropagation();
        onExpand();
      }}
    >
      {/* No name beside it, so it takes the chips' ink, not a glyph's. */}
      <ChipGlyph icon={DotsThreeIcon} ink="text-current" />
    </button>
  );
}

/** One field's chip: its type's icon and its name. */
function FieldChip({
  chip,
  schema,
  tabIndex,
  buttonRef,
  onKeyDown,
  onFocus,
  onOpen,
}: {
  chip: ChipField;
  schema: SchemaIndex;
  tabIndex: number;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const { icon } = useSlotKind(resolveFieldTypeById(chip.fieldId, schema), chip.fieldId, schema);
  return (
    <button
      ref={buttonRef}
      type="button"
      className={CHIP}
      tabIndex={tabIndex}
      data-field-chip={chip.fieldId}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <ChipGlyph icon={icon} />
      <span className="ml-1">{chip.fieldName}</span>
    </button>
  );
}

/**
 * A chip's glyph, as wide as a field row's glyph box so the first one is
 * centred in the glyph column, in the chip's ink at rest unless `ink` says
 * otherwise.
 */
function ChipGlyph({ icon: Glyph, ink = "text-faint-foreground" }: { icon: Icon; ink?: string }) {
  return (
    <span className={cn("flex h-5 w-6 shrink-0 items-center justify-center", ink)}>
      <Glyph size={13} aria-hidden />
    </span>
  );
}
