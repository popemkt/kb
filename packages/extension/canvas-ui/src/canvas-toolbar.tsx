import { useRef, useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import type { CanvasProjectionKind } from "@kb/canvas";
import {
  TOOL_FAMILIES,
  familyOf,
  lastOf,
  type CanvasTool,
  type CanvasToolFamily,
  type ToolState,
} from "./canvas-tool";
import { cn, useDismiss } from "@kb/ui-sdk";
import { STRIP_BOTTOM } from "./canvas-stage-layout";
import { CanvasToolSheet } from "./canvas-tool-sheet";
import { shortcutHint } from "./canvas-keymap";
import { ProjectionToggle, ToolButton } from "./canvas-tool-buttons";
import { STRIP, TOOL_LOOKS, type StripEntry } from "./canvas-tool-looks";

export interface CanvasToolbarProps {
  /** The stage is compact (`compactStage`): one row along the bottom, the rest behind More. */
  compact: boolean;
  projection: CanvasProjectionKind;
  onProjectionChange: (projection: CanvasProjectionKind) => void;
  toolState: ToolState;
  onToolChange: (tool: CanvasTool) => void;
  onToolDoubleClick: (tool: CanvasTool) => void;
}

/** What each family's picker is called. */
const FAMILY_LOOKS: { readonly [F in CanvasToolFamily]: { readonly label: string } } = {
  shape: { label: "Shapes" },
  solid: { label: "Solids" },
};

/**
 * A family's tool (`TOOL_FAMILIES`): one button wearing the tool last
 * picked, which a click picks again and opens the picker beside it with
 * every tool of the family — the solids' box, pillar, sphere, cone, shelf
 * and wall — as tldraw's geo tool does.
 */
function FamilyTool({
  compact,
  family,
  toolState,
  onToolChange,
  onToolDoubleClick,
}: Pick<CanvasToolbarProps, "compact" | "toolState" | "onToolChange" | "onToolDoubleClick"> & {
  readonly family: CanvasToolFamily;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const last = lastOf(toolState, family);
  const active = familyOf(toolState.tool) === family;
  const hint = shortcutHint({ type: "tool", tool: family });
  // The tool's button is its trigger: its click toggles the picker.
  useDismiss(open, { inside: [ref], trigger: triggerRef }, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <ToolButton
        ref={triggerRef}
        compact={compact}
        tool={last}
        active={active}
        sticky={toolState.sticky === true}
        onClick={() => {
          onToolChange(last);
          setOpen((was) => !was);
        }}
        onDoubleClick={() => onToolDoubleClick(last)}
      >
        <CaretRightIcon
          size={7}
          weight="bold"
          className="absolute right-0 bottom-0.5 text-foreground/35"
        />
      </ToolButton>
      {open && (
        <div
          role="menu"
          aria-label={FAMILY_LOOKS[family].label}
          data-testid={`canvas-${family}-picker`}
          className={cn(
            "absolute rounded-lg border border-border bg-popover/95 p-1 shadow-floating backdrop-blur-sm",
            // Beside the column; above the row, its tools as marks a finger reaches, four across.
            compact
              ? "bottom-full left-1/2 mb-2 grid w-max -translate-x-1/2 grid-cols-4 gap-0.5"
              : "top-0 left-full ml-2 flex flex-col gap-0.5",
          )}
        >
          {TOOL_FAMILIES[family].map((preset) => (
            <button
              key={preset}
              type="button"
              role="menuitemradio"
              aria-checked={preset === last}
              aria-label={TOOL_LOOKS[preset].label}
              data-tool={preset}
              className={cn(
                "flex items-center gap-2 rounded-md text-ui text-foreground/65 transition-colors",
                "hover:bg-foreground/5 hover:text-foreground/90",
                compact ? "h-10 w-10 justify-center" : "h-8 pr-3 pl-2",
                preset === last && "bg-foreground/8 text-foreground/90",
              )}
              onClick={() => {
                onToolChange(preset);
                setOpen(false);
              }}
            >
              {TOOL_LOOKS[preset].icon}
              {!compact && TOOL_LOOKS[preset].label}
            </button>
          ))}
          {hint !== "" && !compact && (
            <div className="px-2 pt-1 pb-0.5 text-label text-foreground/35">
              {hint} picks the last one
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One entry of the strip: a tool's button, or a family's. */
function StripButton({
  entry,
  ...props
}: Pick<CanvasToolbarProps, "compact" | "toolState" | "onToolChange" | "onToolDoubleClick"> & {
  readonly entry: StripEntry;
}) {
  const { compact, toolState, onToolChange, onToolDoubleClick } = props;
  if ("family" in entry) return <FamilyTool family={entry.family} {...props} />;
  const { tool } = entry;
  return (
    <ToolButton
      compact={compact}
      tool={tool}
      active={toolState.tool === tool}
      sticky={toolState.sticky === true}
      onClick={() => onToolChange(tool)}
      onDoubleClick={() => onToolDoubleClick(tool)}
    />
  );
}

/**
 * The strip of tools. On a wide stage it stands down the stage's left
 * edge, within the stage: where the stage is too short for one column (a
 * side panel's), it wraps into a second rather than running over the page
 * strip above. On a compact stage it is one row along the bottom, clear of
 * the safe area, holding the strip's first tools and More, which opens the
 * rest and the projection toggle (`CanvasToolSheet`).
 */
export function CanvasToolbar(props: CanvasToolbarProps) {
  const { compact } = props;
  const shown = compact ? STRIP.filter((entry) => entry.more !== true) : STRIP;
  return (
    <div
      className={cn(
        "absolute z-20 flex gap-0.5 rounded-lg border border-border bg-popover/95 p-1 shadow-floating backdrop-blur-sm",
        compact
          ? cn(STRIP_BOTTOM, "left-1/2 -translate-x-1/2 flex-row")
          : "top-1/2 left-2 max-h-[calc(100%-1rem)] -translate-y-1/2 flex-col flex-wrap content-start",
      )}
      data-testid="canvas-toolbar"
      data-compact={compact ? "" : undefined}
      role="toolbar"
      aria-label="Canvas tools"
    >
      {shown.map((entry) => (
        <StripButton key={"tool" in entry ? entry.tool : entry.family} entry={entry} {...props} />
      ))}
      <div
        className={
          compact ? "mx-0.5 my-1.5 w-px bg-foreground/10" : "mx-1.5 my-1 h-px bg-foreground/10"
        }
        role="separator"
      />
      {compact ? <CanvasToolSheet {...props} /> : <ProjectionToggle {...props} />}
    </div>
  );
}
