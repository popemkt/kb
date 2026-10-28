/**
 * An option field laid out as a gallery (DESIGN-UI.md → Field values →
 * option galleries): every option of a one-valued option field at once, each
 * drawn by its kind's preview at card size, the chosen one checked. The
 * field editor draws a field this way when its kind previews at card size
 * (`useOptionPreview(field, "card")`), wherever the field is drawn; a
 * surface never asks for it. Choosing a card is what picking that option in
 * the field's picker is (`pickOne`: noted as a recent pick, then the
 * one-valued field's write), so the gallery is the field's picker shown
 * open, not a second one. It is a radiogroup: the arrow keys move the choice.
 */
import type { KeyboardEvent, ReactNode } from "react";
import { browserHost, cn, type FieldContext, type PropValue } from "@kb/ui-sdk";
import { notePick } from "./picker-recency";

/**
 * Pick `optionId` for a one-valued field: what the field's picker does on a
 * pick, noting it among the field's recent picks, then writing it in place
 * of the value it holds.
 */
function pickOne(nodeId: string, fieldId: string, optionId: string): void {
  notePick(fieldId, optionId);
  void browserHost().writes.updateProp(nodeId, fieldId, { t: "ref", v: optionId });
}

/** The option an arrow key moves the choice to, wrapping; none for another key. */
function stepOf(key: string): number {
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return -1;
  return 0;
}

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
  const current = options.findIndex((id) => id === chosen?.v);
  const choose = (optionId: string) => {
    if (readOnly || optionId === chosen?.v) return;
    pickOne(nodeId, fieldId, optionId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = stepOf(event.key);
    if (step === 0 || options.length === 0) return;
    event.preventDefault();
    const at = (Math.max(current, 0) + step + options.length) % options.length;
    const next = options[at];
    if (next === undefined) return;
    choose(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-option="${next}"]`)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      data-option-gallery={fieldId}
      className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2 py-0.5"
    >
      {options.map((optionId, index) => {
        const on = chosen?.v === optionId;
        const text = context.schema.get(optionId)?.text ?? optionId;
        return (
          <button
            key={optionId}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (current === -1 && index === 0) ? 0 : -1}
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
            onClick={() => choose(optionId)}
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
