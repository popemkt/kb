/** Generic node constructors shared by core and family seeds. */
import { SYSTEM_IDS, type KbNode } from "./model.ts";
import { cardinalityValue, fieldTypeValue, type FieldType } from "./field-type.ts";

/** What a field that holds one value declares: its cardinality. */
const SINGLE: KbNode["props"] = { [SYSTEM_IDS.cardinalityField]: [cardinalityValue("one")] };

/** What a field whose values are not drawn as field rows declares: show never. */
const HIDDEN: KbNode["props"] = { [SYSTEM_IDS.showField]: [{ t: "ref", v: SYSTEM_IDS.showNever }] };

/** What a seed says of a field beside its id, name and type. */
export interface FieldOptions {
  /** It holds one value, not a list. */
  readonly one?: boolean;
  /** Its values are not drawn as field rows (`sys.f.show` never). */
  readonly hidden?: boolean;
  /** Any other declaration it carries. */
  readonly props?: KbNode["props"];
}

/**
 * A system field as a seed declares it, core's or a family's.
 *
 * Every seeded field declares its value type — text ones included. A field's
 * declared type is the contract its values are held to, and `fieldTypeOf`
 * reads an absent one as text: right for a user's untyped field, wrong for
 * nearly every system one (`sys.f.type` holds refs, `sys.f.pinned` a bool).
 * So no system field leans on that default; each says what it holds, and the
 * fill-absent pass of {@link ensureSystemSeed} carries the declaration to
 * older stores.
 *
 * A field that is one setting, not a list, says so (`one`). Absent means
 * many, so only the single-valued ones carry the declaration — and the
 * fill-absent pass carries it to stores seeded before it existed.
 *
 * A field whose values are not drawn as field rows says so too (`hidden`,
 * which writes `sys.f.show` never): one that is a node's structure (its kind, its template,
 * which option set it belongs to) or one a surface of its own draws and
 * writes (a query node's builder, a view's toolbar, the graph's lens
 * settings). Every other system field is drawn and edited like any field
 * (DESIGN.md → Data model → field display).
 */
export function seededField(
  id: string,
  text: string,
  type: FieldType,
  at: string,
  { one = false, hidden = false, props = {} }: FieldOptions = {},
): KbNode {
  return {
    id,
    text,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(type)],
      ...(one ? SINGLE : {}),
      ...(hidden ? HIDDEN : {}),
      ...props,
    },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * A system tag as a seed declares it, core's or a family's: a node typed
 * `sys.tag` whose `sys.f.fields` templates `fields`, in order. The template
 * is what a node tagged with it is offered to fill, so a tag and the fields
 * it stands for are declared together.
 */
export function seededTag(id: string, text: string, fields: readonly string[], at: string): KbNode {
  return {
    id,
    text,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      [SYSTEM_IDS.fieldsField]: fields.map((field) => ({ t: "ref", v: field })),
    },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * A command as a seed declares it, core's or a family's: a node typed
 * `sys.command`, which is what ⌘K offers. Its id is the command's, so the
 * `CommandPoint` contribution that runs it is found by that id.
 */
export function seededCommand(id: string, text: string, at: string): KbNode {
  return {
    id,
    text,
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }] },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}
