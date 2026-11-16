import { WarningIcon, type Icon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { followHowOf, nodeTarget, type Follow } from "../lib/follow";
import { FIELD_LABEL } from "../lib/indent";
import { IconButton } from "./icon-button";
import { OutlineLine } from "./outline-line";

export interface FieldRowProps {
  depth?: number;
  /**
   * The glyph the row wears: a field's is its editor's (the value views'
   * registry answers it beside the editor), a preference's is its own.
   */
  icon: Icon;
  fieldId?: string;
  label: string;
  labelTitle?: string;
  debug?: boolean;
  /** Subtle type-mismatch affordance (UI-only; writes stay permissive). */
  mismatch?: boolean;
  /** Table cells: keep FieldRow shell, hide icon/label chrome (value slot only). */
  valueOnly?: boolean;
  /**
   * Carry out a follow (`useFollow`). Given with a `fieldId`, the glyph is
   * the field's own button: the field is a node, and its page is where it is
   * configured, so the glyph opens it (⌘/Ctrl-click reveals it in place).
   */
  onFollow?: Follow;
  children: React.ReactNode;
  className?: string;
}

/**
 * The field's type glyph, for the row's glyph column. Given a field node and
 * a follow, it is the field's own button: the field is a node, and its page
 * is where it is configured, so the glyph opens it (⌘/Ctrl-click reveals it
 * in place). A row that stands for no field node (a preference) has nothing
 * to open, and draws it still.
 */
function FieldGlyph({
  icon: Glyph,
  fieldId,
  label,
  onFollow,
}: Pick<FieldRowProps, "icon" | "fieldId" | "label" | "onFollow">) {
  if (fieldId === undefined || onFollow === undefined) return <InertGlyph icon={Glyph} />;
  return (
    <IconButton
      size="md"
      weight="regular"
      icon={Glyph}
      label={`Configure field ${label}`}
      data-field-configure={fieldId}
      onClick={(e) => {
        e.stopPropagation();
        onFollow(nodeTarget(fieldId), followHowOf(e));
      }}
    />
  );
}

/** The field's name, on the text column, as wide as the label column. */
function FieldName({
  fieldId,
  label,
  labelTitle,
  debug,
}: Pick<FieldRowProps, "fieldId" | "label" | "labelTitle"> & { debug: boolean }) {
  return (
    <span
      className={cn(
        "flex h-6 shrink-0 items-start self-start truncate pt-px",
        // Same type scale as node text — only the tint differs (Tana).
        "kb-text",
        debug ? "text-foreground/25" : "text-faint-foreground",
      )}
      style={FIELD_LABEL}
      data-field-name=""
      title={labelTitle ?? (fieldId !== undefined ? `${label} (${fieldId})` : label)}
    >
      <span className="truncate">{label}</span>
      {debug && fieldId !== undefined && (
        <span className="ml-1 truncate font-mono text-caption text-foreground/25">{fieldId}</span>
      )}
    </span>
  );
}

/** The glyph of a row with no field node behind it: the icon button's box, drawn still. */
function InertGlyph({ icon: Glyph }: { icon: Icon }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center text-foreground/25">
      <Glyph size={13} aria-hidden />
    </span>
  );
}

/** The UI-only hint that a value's wire kind is not what the field declares. */
function MismatchWarning() {
  return (
    <span
      className="mr-1 mt-0 flex h-6 w-4 shrink-0 items-center justify-center self-start text-warning"
      title="Value type does not match field type"
      data-mismatch-warning="true"
    >
      <WarningIcon size={11} weight="fill" />
    </span>
  );
}

/** DESIGN-RESKIN §1.4 — the one field row everywhere (outline, prefs, …).
 * It is the outline's line (`OutlineLine`): the type glyph in the glyph
 * column, the name from the text column, the value after the label column.
 * Label and glyph are top-aligned to the value's first line.
 */
export function FieldRow({
  depth = 0,
  icon,
  fieldId,
  label,
  labelTitle,
  debug = false,
  mismatch = false,
  valueOnly = false,
  onFollow,
  children,
  className,
}: FieldRowProps) {
  const attributes = {
    "data-field-row": "true",
    "data-field": fieldId,
    "data-field-value-only": valueOnly ? "true" : undefined,
    "data-debug-field": debug ? "true" : undefined,
    "data-field-mismatch": mismatch ? "true" : undefined,
  };
  const value = (
    <>
      {mismatch && <MismatchWarning />}
      <div
        className={cn("min-w-0 flex-1 self-start", valueOnly ? "px-0" : "px-1")}
        data-field-value-column=""
      >
        {children}
      </div>
    </>
  );
  // A table cell is the value alone: no line, so no columns.
  if (valueOnly) {
    return (
      <div
        className={cn("field-row group/field flex items-start gap-0 py-0", className)}
        {...attributes}
      >
        {value}
      </div>
    );
  }
  return (
    <OutlineLine
      depth={depth + 1}
      glyph={<FieldGlyph icon={icon} fieldId={fieldId} label={label} onFollow={onFollow} />}
      text={
        <>
          <FieldName fieldId={fieldId} label={label} labelTitle={labelTitle} debug={debug} />
          {value}
        </>
      }
      textClassName="flex items-start"
      className={cn(
        "field-row group/field gap-0 py-1",
        // Tana's field separators appear on hover only. The border is always
        // present and merely transparent, so revealing it cannot shift the row.
        "border-y border-transparent transition-colors hover:border-foreground/[0.07]",
        debug && "opacity-90",
        className,
      )}
      {...attributes}
    />
  );
}
