/**
 * An option field laid out as a gallery (DESIGN-UI.md → Field values →
 * option galleries): every option of a one-valued option field at once, each
 * drawn by its kind's preview at card size, the chosen one checked. The
 * field editor draws a field this way when its kind previews at card size
 * (`useOptionPreview(field, "card")`), wherever the field is drawn; a
 * surface never asks for it. Choosing is the editor's own write, the one the
 * field's picker makes (`writes.updateProp`, replacing the value), so the
 * gallery is the field's picker shown open, not a second one.
 */
import type { ReactNode } from "react";
import { browserHost, cn, type FieldContext, type PropValue } from "@kb/ui-sdk";

export interface OptionGalleryProps {
  readonly nodeId: string;
  readonly fieldId: string;
  readonly label: string;
  readonly values: readonly PropValue[];
  readonly context: FieldContext;
  readonly readOnly: boolean;
  /** Each option's card, by its option node's id (`useOptionPreview(field, "card")`). */
  readonly card: (optionId: string) => ReactNode;
}

export function OptionGallery({
  nodeId,
  fieldId,
  label,
  values,
  context,
  readOnly,
  card,
}: OptionGalleryProps) {
  const chosen = values.find((value) => value.t === "ref");
  const options = context.schema.get(fieldId)?.children ?? [];
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-option-gallery={fieldId}
      className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2 py-0.5"
    >
      {options.map((optionId) => {
        const on = chosen?.v === optionId;
        const text = context.schema.get(optionId)?.text ?? optionId;
        return (
          <button
            key={optionId}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={text}
            disabled={readOnly}
            data-option={optionId}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors duration-100",
              on
                ? "border-primary bg-primary/10"
                : "border-border hover:border-foreground/30 hover:bg-foreground/[0.03]",
              readOnly && "cursor-default",
            )}
            onClick={() => {
              if (on || readOnly) return;
              void browserHost().writes.updateProp(
                nodeId,
                fieldId,
                { t: "ref", v: optionId },
                chosen,
              );
            }}
          >
            <span className="flex items-baseline justify-between gap-2 text-ui text-foreground">
              <span className="truncate font-medium">{text}</span>
              {on ? <span className="kb-label text-caption text-primary">in use</span> : null}
            </span>
            {card(optionId)}
          </button>
        );
      })}
    </div>
  );
}
