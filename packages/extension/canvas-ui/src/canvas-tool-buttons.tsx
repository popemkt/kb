/**
 * The buttons the canvas's tool strip and its More sheet are made of: a
 * tool's, and the 2D/3D toggle's.
 */
import type { Ref, ReactNode } from "react";
import type { CanvasProjectionKind } from "@kb/canvas";
import type { CanvasTool } from "./canvas-tool";
import { cn } from "@kb/ui-sdk";
import { CANVAS_PROJECTIONS } from "./canvas-projections";
import { shortcutHint } from "./canvas-keymap";
import { PROJECTION_ICONS, TOOL_LOOKS, toolButtonClass } from "./canvas-tool-looks";

/** A tool's name, with the key that picks it when it has one. */
function toolLabel(tool: CanvasTool): string {
  const hint = shortcutHint({ type: "tool", tool });
  return hint === "" ? TOOL_LOOKS[tool].label : `${TOOL_LOOKS[tool].label} (${hint})`;
}

export function ToolButton({
  ref,
  compact,
  tool,
  active,
  sticky,
  onClick,
  onDoubleClick,
  children,
}: {
  ref?: Ref<HTMLButtonElement>;
  compact: boolean;
  tool: CanvasTool;
  active: boolean;
  sticky: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  children?: ReactNode;
}) {
  const { icon } = TOOL_LOOKS[tool];
  const label = toolLabel(tool);
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-tool={tool}
      className={cn(toolButtonClass(compact), active && "bg-foreground/8 text-foreground/90")}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.preventDefault();
        onDoubleClick();
      }}
    >
      {icon}
      {active && sticky && (
        <span className="absolute right-0.5 bottom-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
      )}
      {children}
    </button>
  );
}

/** The 2D/3D toggle: each projection's button, lit while it is the one asked for. */
export function ProjectionToggle({
  compact,
  projection,
  onProjectionChange,
}: {
  readonly compact: boolean;
  readonly projection: CanvasProjectionKind;
  readonly onProjectionChange: (projection: CanvasProjectionKind) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Projection"
      className={cn("flex gap-0.5", compact ? "flex-row" : "flex-col")}
    >
      {CANVAS_PROJECTIONS.map((p) => (
        <button
          key={p.kind}
          type="button"
          title={`${p.label}: ${p.title}`}
          aria-label={`${p.label} projection`}
          aria-pressed={projection === p.kind}
          data-projection={p.kind}
          className={cn(
            toolButtonClass(compact),
            projection === p.kind && "bg-primary/12 text-primary",
          )}
          onClick={() => onProjectionChange(p.kind)}
        >
          {PROJECTION_ICONS[p.kind]}
        </button>
      ))}
    </div>
  );
}
