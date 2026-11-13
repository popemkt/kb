/**
 * Field types' value kinds (DESIGN-UI.md → Field values → Value kinds): what
 * one value of a field of a type is to the slot that holds it, as data, and
 * the surface that draws it.
 *
 * Every value of every field sits in one kind of slot, and the slot owns
 * every gesture: focus, click routing, the keys. A field type contributes only
 * its row: which editor it uses, how its value reads as text and back, the
 * glyph its field wears, and the surface that shows the value and, while the
 * slot edits, edits it. So a new type is a contribution, and a gesture is
 * written once for all of them.
 *
 * `ui.value-kinds` is keyed by the type's option node (a child of
 * `sys.f.fieldType`, `FIELD_TYPE_OPTIONS`): the outline contributes the
 * built-in eight, and a family that declares a type contributes its kind.
 */
import { CORE_POINT_DEFINITIONS } from "@kb/contracts";
import { Predicate, Schema } from "effect";
import type { ComponentType, Ref } from "react";
import type { Icon, IconProps } from "@phosphor-icons/react";
import { declaredOptionId, FIELD_TYPE_OPTIONS, type NodeId, type ParsedValue } from "@kb/model";
import { Point, type ContributionEntry } from "@kb/plugin";
import { componentSchema } from "./component-schema";
import { iconOf, type IconName } from "./form-icons";
import { declaredLocalId } from "./declared.ts";
import type { Follow, FollowTarget } from "./follow";
import type { RefCreation } from "./refs";
import type { FieldContext } from "./schema";
import type { PropValue } from "./types";

/** The ways a slot is edited, the one list of them ({@link EditorMode}). */
const EDITOR_MODE_NAMES = ["caret", "calendar", "picker", "toggle", "swatch"] as const;

/**
 * How a slot is edited.
 *
 * - `caret`: the value is text, and editing puts a caret in it.
 * - `calendar`: a date input replaces the display while editing.
 * - `picker`: a search over the field's allowed nodes replaces the display.
 * - `toggle`: there is nothing to edit; activating the slot flips the value.
 * - `swatch`: the editor is always shown; activating the slot does nothing.
 */
export type EditorMode = (typeof EDITOR_MODE_NAMES)[number];

export interface ValueKindSpec {
  readonly editor: EditorMode;
  /** The value as its editor's text. */
  readonly text: (value: PropValue) => string;
  /**
   * The editor's text as a value, or why it is not one. The typed kinds read
   * it through `parseTypedValue`, the parser the CLI uses and the write check
   * agrees with, so the UI accepts exactly what the store does.
   */
  readonly parse: (text: string) => ParsedValue;
  /** The slot shows its placeholder rather than the value. */
  readonly isBlank: (value: PropValue) => boolean;
  /**
   * How a field's values of this kind sit together: stacked one under the
   * other, or inline and wrapping (chips), so a many-valued field of chips
   * stays on one line.
   */
  readonly layout: "stack" | "inline";
  /**
   * Where the value points, or null for a value that points nowhere. A slot
   * with a target follows it on ⌘/Ctrl-click anywhere and on ⌘Enter; its
   * pointer segments follow on a plain click, as they do in node text.
   */
  readonly follow: (value: PropValue) => FollowTarget | null;
}

/**
 * What a slot's keymap asks of the editor it holds. Only a caret editor has
 * one: the other editors own their keys (`EDITOR_MODES[…].keys`).
 */
export interface EditHandle {
  /** Enter: keep what was typed and leave the editor. */
  commit: () => void;
  /** Escape: put the value back and leave the editor. */
  cancel: () => void;
  /** Shift+Enter: a line break inside the value (text only). */
  softBreak: () => void;
  /** The caret is at the end of a text that is not empty. */
  atEnd: () => boolean;
  /** Where the caret is in the text being edited, and how long that text is. */
  caret: () => { at: number; length: number } | null;
  /**
   * Where a click at a point lands in the text, measured on the value at
   * rest — before the slot swaps it for the editor.
   */
  caretAtPoint: (x: number, y: number) => number | "end";
}

/** Input a kind refused, and why. */
export interface RejectedInput {
  readonly text: string;
  readonly reason: string;
}

/**
 * What a value slot, and a field's picker, may do to the field as a whole —
 * the stack that holds the values provides it.
 */
export interface FieldHandle {
  /**
   * The node that holds the field's values, or null for a value no node
   * holds (a query's slot): what a value may not lead back to (`closesCycleOf`).
   */
  readonly holder: string | null;
  /** Every value the field holds: a picker shows them checked. */
  readonly values: readonly PropValue[];
  /** The field holds many values: its picker toggles, and stays open. */
  readonly many: boolean;
  add: (value: PropValue) => void;
  remove: (value: PropValue) => void;
  /** Mint a node the field may point at (`refCreationOf`); its id, or null. */
  create: (creation: RefCreation, name: string) => Promise<string | null>;
  /** Open the field's picker, for a many-valued field (the stack draws it), with a query typed. */
  openPicker: (query?: string) => void;
  /** Open an empty slot for the next value, after the last. */
  addSlot: () => void;
  /**
   * The keyboard leaves the field for its row: `up` past the first value
   * (the row's text, at its end), `down` past the last (the next row), or
   * `back` (Escape: the row, selected).
   */
  leave: (way: "up" | "down" | "back") => void;
  /** A value took the keyboard: nothing else in the outline holds it now. */
  claimKeyboard: () => void;
  /**
   * Put the keyboard on the value at `index` once the field has redrawn — the
   * slot that asked may be redrawn itself (a committed value is a new one).
   */
  focusSlot: (index: number) => void;
}

/** Everything a kind's surface is handed by the slot that holds it. */
export interface ValueSurfaceProps {
  /** The stored value, or the type's empty value when the slot holds none. */
  value: PropValue;
  /** The slot shows its placeholder rather than the value. */
  blank: boolean;
  /** The slot's editor is open (the slot owns this state). */
  editing: boolean;
  /** Where a caret editor opens: the click's offset, or the end. */
  caretAt: number | "end";
  /**
   * A key typed on the value at rest, which opened the editor: it replaces
   * the value, as typing on a selected value does.
   */
  seed?: string;
  spec: ValueKindSpec;
  /** Pre-formatted label for a ref value, when the caller already has one. */
  display: string;
  /** The field this value belongs to; a ref field's option set is its own. */
  fieldId: string;
  /**
   * What the value resolves against (`fieldContextOf`). A ref editor derives
   * its option set and where it searches from this and `fieldId` itself
   * (`refSearchOf`), so no surface passes, or can forget, either.
   */
  context: FieldContext;
  /** Text the kind could not read, kept so it is never dropped. */
  rejected: RejectedInput | null;
  /**
   * Leave the editor. With a parse, commit what it read — or, when it read
   * nothing, keep `text` as rejected input; without one, nothing changed.
   */
  onEnd: (parsed?: ParsedValue, text?: string) => void;
  /** Where a caret surface exposes itself to the slot's keymap. */
  handleRef: Ref<EditHandle>;
  /** The field the value belongs to, as a whole (a picker edits it). */
  field: FieldHandle;
  /** What an empty value says while it waits (`data-placeholder`). */
  placeholder?: string;
  /** Follow a pointer inside the value: a ref's bullet or tag chip. */
  onFollow: Follow;
}

/**
 * One kind's presentation: the glyph its field wears, and the surface that
 * shows the value and, while the slot edits, edits it in place.
 *
 * Display and edit are one component per kind on purpose — every surface
 * *is* its own display until the slot opens it, which is what makes an
 * inline field feel like text rather than a form control. What a gesture
 * does is not here: the slot owns every gesture, for every kind.
 */
export interface ValueView {
  /** The type glyph the field's row shows in its icon slot. */
  readonly icon: Icon;
  readonly Surface: ComponentType<ValueSurfaceProps>;
}

/** What a field type contributes: its option node, its row of data and its view. */
export interface FieldTypeKind extends ValueView {
  /** The type's option node, a child of `sys.f.fieldType`. */
  readonly type: NodeId;
  readonly spec: ValueKindSpec;
}

/** A function, whatever it takes: the contract can say no more of one. */
function fn<F>() {
  return Schema.declare((value: unknown): value is F => Predicate.isFunction(value), {
    expected: "a function",
  });
}

/**
 * What every contribution to {@link ValueKindPoint} is held to before any
 * slot reads it: a page half's is third-party code built against whichever
 * SDK it was, and a slot calls its spec on every draw. The kernel refuses
 * one that is not this ("invalid-contribution"), with the plugin that made
 * it, and a field of its type draws as the type it stores as.
 */
const FieldTypeKindData = Schema.Struct({
  type: Schema.String,
  spec: Schema.Struct({
    editor: Schema.Literals(EDITOR_MODE_NAMES),
    text: fn<ValueKindSpec["text"]>(),
    parse: fn<ValueKindSpec["parse"]>(),
    isBlank: fn<ValueKindSpec["isBlank"]>(),
    layout: Schema.Literals(["stack", "inline"]),
    follow: fn<ValueKindSpec["follow"]>(),
  }),
  icon: componentSchema<IconProps>(),
  Surface: componentSchema<ValueSurfaceProps>(),
});

/** Field types' value kinds, by the type's option node. */
export const ValueKindPoint = Point<FieldTypeKind>()(CORE_POINT_DEFINITIONS.valueKind.name, {
  ...CORE_POINT_DEFINITIONS.valueKind.spec,
  contract: Schema.toStandardSchemaV1(FieldTypeKindData),
});

/** A family's field type's value kind, as its page half writes it: the glyph by name. */
export interface ValueKindForm {
  readonly icon: IconName;
  readonly spec: ValueKindSpec;
  readonly Surface: ComponentType<ValueSurfaceProps>;
}

/**
 * The {@link ValueKindPoint} contribution for the field type a declaration
 * declares as `id` among `FIELD_TYPE_OPTIONS` (`<name>.<local id>`): its
 * kind, for the type's option node, answering to the declared id. An icon kb does not name throws where
 * its plugin applies.
 */
export function provideValueKind(
  id: string,
  form: ValueKindForm,
): ContributionEntry<FieldTypeKind> {
  const icon = iconOf(`value kind ${id}`, form.icon);
  const type = declaredOptionId(FIELD_TYPE_OPTIONS, id);
  return { id: declaredLocalId(id), value: { type, spec: form.spec, icon, Surface: form.Surface } };
}
