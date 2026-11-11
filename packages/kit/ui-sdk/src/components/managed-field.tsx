/**
 * The note under a managed field's values (`useFieldWrite`, DESIGN-UI.md →
 * Node-scoped commands → a managed field edits after one step): the family
 * that keeps the field, and the step that lets a person edit it.
 */
import type { ManagedWrite } from "../lib/field-write";

/** The note under a managed field's values, with the step that edits them and the one back. */
export function ManagedNote({ managed }: { readonly managed: ManagedWrite }) {
  const { by, editing, setEditing } = managed;
  return (
    <div
      className="flex h-6 items-center gap-1.5 text-caption text-faint-foreground"
      data-managed-note={editing ? "editing" : "at-rest"}
    >
      <span>managed by {by}</span>
      <button
        type="button"
        className="rounded-sm px-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        title={editing ? `Stop editing; ${by} keeps this field` : `Edit a field ${by} keeps`}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(!editing);
        }}
      >
        {editing ? "Done" : "Edit"}
      </button>
    </div>
  );
}
