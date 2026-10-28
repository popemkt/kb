/**
 * More, at the end of a compact stage's row of tools (DESIGN-UI.md →
 * Canvas → The compact stage): a sheet over the row with every tool the
 * strip leaves behind More (`STRIP`), each tool of a family among them laid
 * out by itself, and the projection toggle. Picking a tool puts it away; it
 * dismisses as every popover does.
 */
import { useRef, useState } from "react";
import { DotsThreeIcon } from "@phosphor-icons/react";
import type { CanvasProjectionKind } from "@kb/canvas";
import { cn, useDismiss } from "@kb/ui-sdk";
import { TOOL_FAMILIES, type CanvasTool, type ToolState } from "./canvas-tool";
import { ProjectionToggle, ToolButton } from "./canvas-tool-buttons";
import { STRIP, toolButtonClass } from "./canvas-tool-looks";

/** The tools behind More, in the strip's order, each family's spread out. */
const MORE_TOOLS: readonly CanvasTool[] = STRIP.flatMap((entry): readonly CanvasTool[] => {
  if (entry.more !== true) return [];
  return "family" in entry ? TOOL_FAMILIES[entry.family] : [entry.tool];
});

export function CanvasToolSheet({
  toolState,
  onToolChange,
  onToolDoubleClick,
  projection,
  onProjectionChange,
}: {
  readonly toolState: ToolState;
  readonly onToolChange: (tool: CanvasTool) => void;
  readonly onToolDoubleClick: (tool: CanvasTool) => void;
  readonly projection: CanvasProjectionKind;
  readonly onProjectionChange: (projection: CanvasProjectionKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useDismiss(open, { inside: [sheet], trigger }, () => setOpen(false));
  // The tool armed is behind More: More wears it lit, so the row says what a press does.
  const behind = MORE_TOOLS.includes(toolState.tool);
  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        title="More tools"
        aria-label="More tools"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(toolButtonClass(true), behind && "bg-foreground/8 text-foreground/90")}
        onClick={() => setOpen((was) => !was)}
      >
        <DotsThreeIcon size={18} weight="bold" />
      </button>
      {open && (
        <div
          ref={sheet}
          role="menu"
          aria-label="More tools"
          data-testid="canvas-tool-sheet"
          className="absolute right-0 bottom-full mb-2 flex w-max flex-col gap-1 rounded-lg border border-border bg-popover/95 p-1 shadow-floating backdrop-blur-sm"
        >
          <div className="grid grid-cols-5 gap-0.5">
            {MORE_TOOLS.map((tool) => (
              <ToolButton
                key={tool}
                compact
                tool={tool}
                active={toolState.tool === tool}
                sticky={toolState.sticky === true}
                onClick={() => {
                  onToolChange(tool);
                  setOpen(false);
                }}
                onDoubleClick={() => onToolDoubleClick(tool)}
              />
            ))}
          </div>
          <div className="mx-1 h-px bg-foreground/10" role="separator" />
          <ProjectionToggle
            compact
            projection={projection}
            onProjectionChange={(kind) => {
              onProjectionChange(kind);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
