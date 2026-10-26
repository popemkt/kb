import { styleOf, type CanvasEdge, type KbLinkMode } from "@kb/canvas";
import { cn } from "@kb/ui-sdk";
import {
  DockMore,
  DockPanel,
  DockSection,
  DockPick,
  IconRow,
  type IconChoice,
} from "./canvas-dock";
import { ColorSwatches, EdgeLookRows } from "./item-style-rows";

export interface EdgeInspectorProps {
  edge: CanvasEdge;
  /** The ref fields a native link on this edge can bind (`edgeFields`). */
  refFields: readonly { readonly id: string; readonly text: string }[];
  onModeChange: (mode: KbLinkMode) => void;
  onFieldChange: (fieldId: string) => void;
  onDelete: () => void;
  /** The edge changed as one step: its label, colour, route or looks. */
  onChange: (edge: CanvasEdge) => void;
}

const LINK_MODES: readonly IconChoice<KbLinkMode>[] = [
  { value: "layout", label: "Canvas only", icon: <span className="text-label">Canvas</span> },
  {
    value: "native",
    label: "Node relationship",
    icon: <span className="text-label">Relation</span>,
  },
];

/** A field of the edge panel's: its text, small. */
const FIELD = "h-6 rounded-md border border-border bg-background px-1.5 text-label";

/** `edge` with `key` set to `value`, or without it when `value` is blank. */
function withText(edge: CanvasEdge, key: "label" | "color", value: string | undefined) {
  const updated = { ...edge };
  if (value === undefined || value === "") delete updated[key];
  else updated[key] = value;
  return updated;
}

/** Whether the edge draws a canvas line only, or binds a ref field between its ends' nodes. */
function LinkRows({
  edge,
  refFields,
  onModeChange,
  onFieldChange,
}: Pick<EdgeInspectorProps, "edge" | "refFields" | "onModeChange" | "onFieldChange">) {
  const mode = edge.kbLink?.mode ?? "layout";
  const fieldId = edge.kbLink?.fieldId ?? "";
  return (
    <div className="flex flex-col gap-1.5 px-2.5 pb-1.5">
      <IconRow label="Mode" value={mode} choices={LINK_MODES} onChange={onModeChange} />
      <p className="text-label leading-snug text-foreground/45">
        {mode === "layout"
          ? "This connection appears on this canvas only."
          : "This connection uses a reference field between the underlying nodes."}
      </p>
      {mode === "native" && (
        <div role="radiogroup" aria-label="Ref field" className="flex flex-col gap-0.5">
          <span className="text-label text-foreground/50">Ref field</span>
          {refFields.length === 0 && (
            <span className="text-label text-foreground/35">No ref field joins these nodes.</span>
          )}
          {refFields.map((f) => (
            <DockPick
              key={f.id}
              role="radio"
              aria-checked={f.id === fieldId}
              className={cn(
                "truncate rounded-md px-1.5 py-0.5 text-left text-label",
                f.id === fieldId
                  ? "bg-foreground/[0.08] text-foreground"
                  : "text-foreground/65 hover:bg-foreground/5",
              )}
              onClick={() => onFieldChange(f.id)}
            >
              {f.text}
            </DockPick>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The selected edge's style panel, docked (`CanvasDock`): its label and
 * colour, how it runs and what it wears, and under More whether it is a
 * relationship between its ends' nodes, and its delete.
 */
export function EdgeInspector({
  edge,
  refFields,
  onModeChange,
  onFieldChange,
  onDelete,
  onChange,
}: EdgeInspectorProps) {
  return (
    <DockPanel name="style" title="Edge" data-testid="edge-inspector">
      <DockSection>
        <input
          type="text"
          aria-label="Label"
          className={cn(FIELD, "w-full text-ui")}
          value={edge.label ?? ""}
          placeholder="Label…"
          onChange={(e) => onChange(withText(edge, "label", e.target.value))}
        />
        <ColorSwatches
          value={styleOf(edge).color}
          onChange={(color) => onChange(withText(edge, "color", color))}
        />
      </DockSection>
      <EdgeLookRows edge={edge} onChange={onChange} />
      <DockMore>
        <LinkRows
          edge={edge}
          refFields={refFields}
          onModeChange={onModeChange}
          onFieldChange={onFieldChange}
        />
        <div className="px-2.5 pb-1">
          <button
            type="button"
            className={cn(
              "w-full rounded-md border border-destructive/30 px-2 py-1",
              "text-label text-destructive hover:bg-destructive/10",
            )}
            onClick={onDelete}
          >
            Delete edge
          </button>
        </div>
      </DockMore>
    </DockPanel>
  );
}
