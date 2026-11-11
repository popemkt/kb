/**
 * The page's field editor: one field of one node, drawn and edited as its
 * type and the write rule allow (DESIGN-UI.md → Field values). Every surface
 * that shows a node's field draws it with this one editor, so a field reads
 * and edits the same wherever it appears: a frame view lays out fields its
 * host edits, and the agent's dock edits the agent's settings, which are
 * fields on its node. Core names no editor; the outline provides its own
 * while it is loaded, and with none provided a field draws nothing.
 */
import { Fragment, createElement, type ComponentType } from "react";
import { Service, Role, type PluginContext } from "@kb/plugin";
import { parseTypedValue, type FieldType, type ParsedValue } from "@kb/model";
import { ManagedNote } from "../components/managed-field";
import { useFieldWrite } from "./field-write";
import { browserHost } from "../host";
import { resolveFieldTypeById } from "./field-type";
import { FIELD_EDITOR_ROLE } from "@kb/contracts";
import { useRole } from "./plugins";
import type { FieldContext } from "./schema";
import type { PropValue } from "./types";

/** One field of one node, as the page edits it. */
export interface FieldEditorProps {
  readonly nodeId: string;
  readonly fieldId: string;
  /** The field's name, as the surface resolved it. */
  readonly label: string;
  readonly values: PropValue[];
  /** What the values resolve against (the surface's `GraphRead`). */
  readonly context: FieldContext;
  /** The row instance the field is drawn under, inside a frame (the keyboard's way back). */
  readonly instanceKey?: string;
  /** Only the value, without the field's label (a table cell). */
  readonly valueOnly?: boolean;
  /** Indent of the label column; a card or a settings row passes -1. */
  readonly depth?: number;
  /** A field its node hides, revealed by the node's debug-fields setting. */
  readonly debug?: boolean;
}

/** Where a plugin provides the page's field editor while it is loaded. */
export const FieldEditorService = Service<ComponentType<FieldEditorProps>>()(
  FIELD_EDITOR_ROLE.role,
  FIELD_EDITOR_ROLE.spec,
);

/** What a field is drawn with while no editor is provided: nothing. */
// GAP [[01M5MWXM43Y12KDBM4JG7X1VRX]] with no editor family loaded, a field draws nothing
const FieldEditorRole = Role(FieldEditorService);

/** The page's field editor now, re-read when the plugins change. */
export function useFieldEditor(): ComponentType<FieldEditorProps> {
  return useRole(FieldEditorRole);
}

/** The author-facing row contract; writes stay on the host's checked action path. */
export interface FieldRowProps extends Pick<
  FieldEditorProps,
  "nodeId" | "fieldId" | "label" | "values" | "valueOnly"
> {
  readonly fieldType: FieldType;
  readonly readOnly: boolean;
  readonly parse: (text: string) => ParsedValue;
  readonly update: (value: PropValue, previous?: PropValue) => Promise<void>;
  readonly remove: (value?: PropValue) => Promise<void>;
}

/** Offer this family's row component; the kernel admits it only for an approved role claim. */
export function provideFieldEditor(ctx: PluginContext, Component: ComponentType<FieldRowProps>) {
  function Editor({ nodeId, fieldId, label, values, context, valueOnly }: FieldEditorProps) {
    const { schema } = context;
    const fieldType = resolveFieldTypeById(fieldId, schema);
    // The row is the family's; a managed field's note is the page's, under it.
    const { readOnly, managed } = useFieldWrite(nodeId, fieldId, schema);
    const row = createElement(Component, {
      nodeId,
      fieldId,
      label,
      values,
      valueOnly,
      fieldType,
      parse: (text) => parseTypedValue(text, fieldType),
      readOnly,
      update: (value, previous) =>
        browserHost().writes.updateProp(nodeId, fieldId, value, previous),
      remove: (value) => browserHost().writes.removeProp(nodeId, fieldId, value),
    });
    return managed === null
      ? row
      : createElement(Fragment, null, row, createElement(ManagedNote, { managed }));
  }
  return ctx.provide(FieldEditorService, Editor);
}
