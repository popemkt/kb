/**
 * The slots a condition row is a sentence of. Every slot is a button with an
 * accessible name ("field: status") and a Tab stop; Enter or a click opens
 * what edits it, and that is always something the editor already has:
 *
 * - a choice (a subject, an operator, a tag, a node, a group's kind) is the
 *   one node picker's input (`PickerInput`) over the slot's candidates;
 * - a field's values are the field's own: its picker (`FieldPicker`) for
 *   picked values, its `ValueSlot` for typed ones (the slot grammar, so
 *   `today`, `+7d` and ISO dates read as they do in a field), and a
 *   checkbox's toggle (`toggledValue`).
 *
 * Closing what a slot opened gives the keyboard back to the slot, and a
 * pick moves it on to the next slot, opening that one when it is still
 * empty, so a row is said slot by slot.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  browserHost,
  cn,
  pickerRows,
  type FieldContext,
  type FieldType,
  type PickerCandidate,
  type PropValue,
} from "@kb/ui-sdk";
import { FieldPicker, PickerInput, type FieldHandle } from "../field-picker";
import { ValueSlot } from "../value-slot";
import { toggledValue } from "../value-kind";
import { advanceFrom, slotClass } from "./slot-dom";

/**
 * Where the keyboard goes when what a slot opened closes: back to the slot
 * (Escape), on to the next one (a pick), or nowhere (Tab, a click away).
 */
type Then = "stay" | "advance" | "leave";

/** A slot's open state, and the keyboard's landing once it closes. */
function useSlotOpen(autoOpen: boolean) {
  const [open, setOpen] = useState(autoOpen);
  const button = useRef<HTMLButtonElement>(null);
  /** What the slot opened, while it is open. */
  const editor = useRef<HTMLSpanElement>(null);
  const then = useRef<Then>("leave");

  // A row a gesture just made opens its first slot; rows are drawn by
  // place, so the slot may already be drawn when it is asked to.
  const [asked, setAsked] = useState(autoOpen);
  if (autoOpen !== asked) {
    setAsked(autoOpen);
    if (autoOpen) setOpen(true);
  }

  useLayoutEffect(() => {
    if (open) return;
    const landing = then.current;
    then.current = "leave";
    if (landing === "stay") button.current?.focus();
    else if (landing === "advance") advanceFrom(button.current);
  }, [open]);

  /** Close, landing as `how` says; a landing already asked for is not undone by a later blur. */
  const close = (how: Then) => {
    if (then.current === "leave") then.current = how;
    setOpen(false);
  };
  const begin = () => {
    then.current = "leave";
    setOpen(true);
  };
  /**
   * Its editor gave up: Escape, while the keyboard is still in it, goes back
   * to the slot; a blur, the keyboard already gone, goes nowhere.
   */
  const cancel = () => {
    const holds = editor.current?.contains(editor.current.ownerDocument.activeElement) === true;
    close(holds ? "stay" : "leave");
  };
  return { open, button, editor, close, begin, cancel };
}

export interface ChoiceSlotProps<Id extends string = string> {
  /** What the slot is, for its accessible name: "field", "operator", "tag". */
  name: string;
  /** The choice it holds, in words; empty while none is made. */
  label: string;
  /** How it is drawn at rest; the label, when absent. */
  children?: ReactNode;
  tone: "subject" | "operator" | "value";
  candidates: readonly (PickerCandidate & { readonly id: Id })[];
  /** The id of the choice made, checked in the list. */
  chosen?: Id;
  onPick: (id: Id) => void;
  /** Open as it is drawn: the gesture that made the row is still saying it. */
  autoOpen?: boolean;
  /** What the slot shows while nothing is chosen. */
  placeholder?: string;
  /** The picker input's accessible name. */
  pickLabel: string;
}

/** A slot whose value is one choice among candidates, picked with the one node picker. */
export function ChoiceSlot<Id extends string = string>({
  name,
  label,
  children,
  tone,
  candidates,
  chosen,
  onPick,
  autoOpen = false,
  placeholder = "…",
  pickLabel,
}: ChoiceSlotProps<Id>) {
  const { open, button, editor, close, begin, cancel } = useSlotOpen(autoOpen);
  const [query, setQuery] = useState("");
  if (open) {
    const rows = pickerRows(candidates, {
      query,
      selected: chosen === undefined ? undefined : new Set([chosen]),
      limit: 50,
    });
    return (
      <span ref={editor} className="inline-flex min-w-[10rem]">
        <PickerInput
          query={query}
          onQuery={setQuery}
          rows={rows}
          onPick={(row) => {
            setQuery("");
            const picked =
              row?.kind === "item" && !row.disabled
                ? candidates.find((c) => c.id === row.id)
                : undefined;
            if (picked === undefined) close("stay");
            else {
              onPick(picked.id);
              close("advance");
            }
          }}
          onCancel={() => {
            setQuery("");
            cancel();
          }}
          placeholder="Search…"
          label={pickLabel}
          listLabel={pickLabel}
          hint="↵ pick · esc close"
          marker={{ "data-qb-picker": name }}
        />
      </span>
    );
  }
  const empty = label === "";
  return (
    <button
      ref={button}
      type="button"
      className={cn(slotClass(tone), empty && "italic text-foreground/35")}
      aria-label={`${name}: ${empty ? "none" : label}`}
      aria-haspopup="listbox"
      data-qb-slot={name}
      data-qb-empty={empty ? "true" : undefined}
      onClick={begin}
    >
      {empty ? placeholder : (children ?? label)}
    </button>
  );
}

/** What a value slot edits, and how. */
export type ValueEditing =
  /** Picked values of a ref or option field, any of them: the field's own picker. */
  | { readonly t: "picked" }
  /** Typed values, each in the field's own value slot. */
  | { readonly t: "typed"; readonly type: FieldType }
  /** A checkbox, flipped where it sits. */
  | { readonly t: "toggle" };

export interface ValuesSlotProps {
  name: string;
  /** The values, in words, for the slot's accessible name. */
  label: string;
  /** The values as the slot draws them at rest. */
  children?: ReactNode;
  /** The field the values are of: its picker, kind and grammar are theirs. */
  fieldId: string;
  context: FieldContext;
  values: readonly PropValue[];
  editing: ValueEditing;
  onValues: (values: PropValue[]) => void;
  autoOpen?: boolean;
  placeholder?: string;
}

const sameValue = (a: PropValue, b: PropValue) => a.t === b.t && a.v === b.v;

/**
 * A slot holding a field's values: at rest a button that shows them, and
 * open, the field's own editor over them.
 */
export function ValuesSlot({
  name,
  label,
  children,
  fieldId,
  context,
  values,
  editing,
  onValues,
  autoOpen = false,
  placeholder = "…",
}: ValuesSlotProps) {
  const { open, button, editor, close, begin, cancel } = useSlotOpen(
    autoOpen && editing.t !== "toggle",
  );

  if (open && editing.t !== "toggle") {
    const field: FieldHandle = {
      values,
      many: editing.t === "picked",
      add: (value) => onValues([...values, value]),
      remove: (value) => onValues(values.filter((v) => !sameValue(v, value))),
      create: (creation, text) => browserHost().writes.createRefTarget(creation, text),
      openPicker: () => undefined,
      addSlot: () => undefined,
      leave: (way) => close(way === "down" ? "advance" : "stay"),
      claimKeyboard: () => undefined,
      focusSlot: () => close("stay"),
    };
    if (editing.t === "picked") {
      return (
        <span ref={editor} className="inline-flex min-w-[10rem]">
          <FieldPicker
            fieldId={fieldId}
            context={context}
            field={field}
            onReplace={(id) => {
              onValues([{ t: "ref", v: id }]);
              close("advance");
            }}
            onClose={cancel}
          />
        </span>
      );
    }
    const shown = values.length === 0 ? [null] : values;
    return (
      <span
        ref={editor}
        className="inline-flex min-w-[6rem] items-center gap-1"
        data-qb-editing={name}
        onKeyDownCapture={(e) => {
          // The slot reverts on Escape and keeps the value focused; the
          // builder then takes the keyboard back to its own slot.
          if (e.key === "Escape") queueMicrotask(() => close("stay"));
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) close("leave");
        }}
      >
        {shown.map((value, i) => (
          <ValueSlot
            key={value === null ? "new" : `${value.t}:${String(value.v)}#${i}`}
            value={value}
            fieldType={editing.type}
            fieldId={fieldId}
            context={context}
            autoOpen={i === 0}
            field={field}
            onFollow={() => undefined}
            onCommit={(next) => {
              const out = [...values];
              out.splice(value === null ? out.length : i, value === null ? 0 : 1, next);
              onValues(out);
            }}
            onRemove={() => {
              onValues(values.filter((_, j) => j !== i));
              close("stay");
            }}
          />
        ))}
      </span>
    );
  }

  const empty = values.length === 0;
  return (
    <button
      ref={button}
      type="button"
      className={cn(slotClass("value"), empty && "italic text-foreground/35")}
      aria-label={`${name}: ${empty ? "none" : label}`}
      aria-pressed={editing.t === "toggle" ? values[0]?.v === true : undefined}
      data-qb-slot={name}
      data-qb-empty={empty && editing.t !== "toggle" ? "true" : undefined}
      onClick={() => {
        if (editing.t === "toggle") {
          onValues([toggledValue(values[0] ?? { t: "bool", v: false })]);
        } else begin();
      }}
    >
      {empty && editing.t !== "toggle" ? placeholder : (children ?? label)}
    </button>
  );
}
