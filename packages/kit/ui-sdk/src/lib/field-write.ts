/**
 * How a field row may be written, as the page draws it (DESIGN-UI.md →
 * Node-scoped commands → a managed field edits after one step). The write
 * rule is `@kb/model`'s `fieldWriting`; this is its one reading on the
 * page, so every editor of a field — the outline's, and a family's own
 * row — shows it the same way.
 *
 * A field a family manages (`sys.f.managedBy`) shows its values at rest,
 * under a note naming the family (`ManagedNote`), and a person edits them
 * after one deliberate step. That is friction, not a lock: the commit
 * admits the person's write as it would the family's, and the family's
 * constraints judge both (DESIGN.md → Data-plane freedom).
 */
import { useState } from "react";
import { fieldWriting } from "@kb/model";
import { formatPropValue } from "./graph-view";
import type { SchemaIndex } from "./schema";

/** A managed field's family, and the step that lets a person edit it. */
export interface ManagedWrite {
  /** The family's name, as the graph labels it. */
  readonly by: string;
  /** Whether the person has taken the step, so the row edits now. */
  readonly editing: boolean;
  readonly setEditing: (editing: boolean) => void;
}

/** One field row's writing, now. */
interface FieldWrite {
  /** Whether the row draws its values without editing them. */
  readonly readOnly: boolean;
  /** Set when a family manages the field; null for a field nobody manages. */
  readonly managed: ManagedWrite | null;
}

/** How the row of `fieldId` on `nodeId` may be written; the step is the row's own. */
export function useFieldWrite(nodeId: string, fieldId: string, schema: SchemaIndex): FieldWrite {
  const [editing, setEditing] = useState(false);
  const writing = fieldWriting(schema.get(nodeId) ?? { id: nodeId }, fieldId, schema.get(fieldId));
  if (writing.kind !== "managed") return { readOnly: writing.kind === "closed", managed: null };
  const by = formatPropValue({ t: "ref", v: writing.family }, schema);
  return { readOnly: !editing, managed: { by, editing, setEditing } };
}
