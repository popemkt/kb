import type { ReactNode } from "react";
import type { CanvasNode, CanvasProjectionKind } from "@kb/canvas";
import {
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  CaretLeftIcon,
  CaretRightIcon,
  FrameCornersIcon,
  SelectionSlashIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { PresentAct } from "./canvas-keymap";
import { frameName } from "./canvas-frame-name";
import { CanvasToolbar } from "./canvas-toolbar";
import { NodePicker } from "./node-picker";
import type { CanvasSelection } from "./canvas-selection";
import { selectionEmpty } from "./canvas-selection";
import type { CanvasTool, ToolState } from "./canvas-tool";
import { GIZMO_MODES, type GizmoChoice } from "./canvas-gizmo";
import { cn } from "@kb/ui-sdk";
import { bottomBarClass } from "./canvas-stage-layout";

/** Where present mode stands: the frame shown, by its place among how many. */
interface PresentingAt {
  at: number;
  frames: number;
  frame: CanvasNode | undefined;
}

interface CanvasOverlaysProps {
  /** The stage is compact (`compactStage`): the tools along the bottom, the bars above them, marks for words. */
  compact: boolean;
  /** A modal transform is under way: its readout stands where the selection toolbar does. */
  transforming: boolean;
  /** The group entered, whose members a press reaches one by one; null at the canvas. */
  scope: CanvasNode | null;
  onLeaveScope: () => void;
  /** Present mode's place, or null when not presenting: its bar stands where the selection toolbar does. */
  presenting: PresentingAt | null;
  onPresent: (act: PresentAct) => void;
  onGroup: () => void;
  onUngroup: () => void;
  /** A group is among the selected items, so the selection can be taken apart. */
  canUngroup: boolean;
  projection: CanvasProjectionKind;
  onProjectionChange: (projection: CanvasProjectionKind) => void;
  selection: CanvasSelection;
  toolState: ToolState;
  pickerOpen: boolean;
  onToolChange: (tool: CanvasTool) => void;
  onToolDoubleClick: (tool: CanvasTool) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDeleteSelection: () => void;
  onPickNode: (nodeId: string) => void;
  onClosePicker: () => void;
  /** The 3D gizmo's choice, which the selection toolbar switches; null where there is no gizmo (2D). */
  gizmo: GizmoChoice | null;
  onGizmoChange: (choice: GizmoChoice) => void;
}

/** One of the toolbar's switch buttons: lit while it is the one chosen. */
const switchClass = (on: boolean) =>
  cn(
    "rounded-md px-1.5 py-1 text-label",
    on ? "bg-primary/15 text-primary" : "text-foreground/60 hover:bg-foreground/5",
  );

/**
 * The gizmo's switches: which transform its handles make (the last one
 * chosen stays), and whether they run along the canvas's axes or the
 * selection's own.
 */
function GizmoSwitches({
  gizmo,
  onGizmoChange,
}: {
  gizmo: GizmoChoice;
  onGizmoChange: (choice: GizmoChoice) => void;
}) {
  const local = gizmo.space === "local";
  return (
    <>
      <div className="flex items-center gap-0.5" role="group" aria-label="Gizmo">
        {GIZMO_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={gizmo.mode === mode}
            className={switchClass(gizmo.mode === mode)}
            onClick={() => onGizmoChange({ ...gizmo, mode })}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={local}
        title={
          local
            ? "Along the selection's own axes"
            : "Along the canvas's axes (X red, Y green, Z blue)"
        }
        className={switchClass(local)}
        onClick={() => onGizmoChange({ ...gizmo, space: local ? "global" : "local" })}
      >
        {local ? "Local" : "Global"}
      </button>
      <div className="mx-1 h-4 w-px bg-foreground/10" />
    </>
  );
}

/** The group entered, named where the canvas starts, with the way out. */
function ScopeChip({ scope, onLeave }: { scope: CanvasNode; onLeave: () => void }) {
  return (
    <div
      className="absolute top-3 left-3 z-20 flex items-center gap-1.5 rounded-md border border-primary/25 bg-popover/95 py-0.5 pr-0.5 pl-2 text-label text-foreground/70 shadow-floating backdrop-blur-sm"
      data-testid="canvas-scope"
    >
      <span className="text-foreground/40">Inside</span>
      <span className="max-w-48 truncate">{frameName(scope, "a frame")}</span>
      <button
        type="button"
        title="Leave the group (Esc)"
        className="rounded-sm px-1.5 py-0.5 text-foreground/55 hover:bg-foreground/5 hover:text-foreground/85"
        onClick={onLeave}
      >
        Esc
      </button>
    </div>
  );
}

/** Present mode's bar: back and forward through the frames (the arrows and Space do too), and out. */
function PresentBar({
  compact,
  presenting,
  onPresent,
}: {
  compact: boolean;
  presenting: PresentingAt;
  onPresent: (act: PresentAct) => void;
}) {
  const { at, frames, frame } = presenting;
  const step = "rounded-md p-1 text-foreground/60 hover:bg-foreground/5 disabled:opacity-30";
  return (
    <div
      className={cn(
        "absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg whitespace-nowrap border border-border bg-popover/95 px-2 py-1.5 shadow-floating backdrop-blur-sm",
        bottomBarClass(compact),
      )}
      data-testid="canvas-present-bar"
    >
      <button
        type="button"
        aria-label="Previous frame"
        className={step}
        disabled={at === 0}
        onClick={() => onPresent("previous")}
      >
        <CaretLeftIcon size={13} />
      </button>
      <span className="min-w-24 text-center text-label text-foreground/70 tabular-nums">
        {frameName(frame, `Frame ${at + 1}`)} · {at + 1} / {frames}
      </span>
      <button
        type="button"
        aria-label="Next frame"
        className={step}
        disabled={at === frames - 1}
        onClick={() => onPresent("next")}
      >
        <CaretRightIcon size={13} />
      </button>
      <div className="mx-1 h-4 w-px bg-foreground/10" />
      <button
        type="button"
        aria-label="Stop presenting"
        title="Stop presenting (Esc)"
        className={step}
        onClick={() => onPresent("stop")}
      >
        <XIcon size={13} />
      </button>
    </div>
  );
}

/** One of the selection toolbar's plain buttons: its words, or on a compact stage its mark, a finger's size. */
const barButton = (compact: boolean, tone = "text-foreground/60 hover:bg-foreground/5") =>
  cn(
    "flex items-center justify-center rounded-md text-label",
    compact ? "h-9 min-w-9 px-2" : "px-1.5 py-1",
    tone,
  );

/** One command of the selection toolbar: its name, which a compact stage shows as a mark, named for a screen reader. */
function BarCommand({
  compact,
  label,
  mark,
  title,
  tone,
  onClick,
}: {
  compact: boolean;
  label: string;
  mark: ReactNode;
  title: string;
  tone?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={compact ? label : undefined}
      className={barButton(compact, tone)}
      onClick={onClick}
    >
      {compact ? mark : label}
    </button>
  );
}

/**
 * The floating selection toolbar: in 3D the gizmo's switches, then group
 * or ungroup, reorder, delete. What it looks like is the docked style
 * panel's (`CanvasStylePanel`). On a compact stage it stands above the
 * tools and says each command with its mark.
 */
function SelectionBar({
  compact,
  count,
  canGroup,
  canUngroup,
  gizmo,
  onGizmoChange,
  onGroup,
  onUngroup,
  onBringToFront,
  onSendToBack,
  onDeleteSelection,
}: {
  count: number;
  canGroup: boolean;
} & Pick<
  CanvasOverlaysProps,
  | "compact"
  | "canUngroup"
  | "gizmo"
  | "onGizmoChange"
  | "onGroup"
  | "onUngroup"
  | "onBringToFront"
  | "onSendToBack"
  | "onDeleteSelection"
>) {
  return (
    <div
      className={cn(
        "absolute left-1/2 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-lg whitespace-nowrap border border-border bg-popover/95 px-2 py-1.5 shadow-floating backdrop-blur-sm",
        bottomBarClass(compact),
      )}
      data-testid="canvas-selection-bar"
    >
      <span className="mr-1 text-label text-foreground/40">
        {compact ? count : `${count} selected`}
      </span>
      {gizmo !== null && <GizmoSwitches gizmo={gizmo} onGizmoChange={onGizmoChange} />}
      {canGroup && (
        <BarCommand
          compact={compact}
          label="Group"
          mark={<FrameCornersIcon size={18} />}
          title="Group into a frame (⌘G)"
          onClick={onGroup}
        />
      )}
      {canUngroup && (
        <BarCommand
          compact={compact}
          label="Ungroup"
          mark={<SelectionSlashIcon size={18} />}
          title="Ungroup (⌘⇧G)"
          onClick={onUngroup}
        />
      )}
      <BarCommand
        compact={compact}
        label="↑ Front"
        mark={<ArrowLineUpIcon size={18} />}
        title="Bring to front"
        onClick={onBringToFront}
      />
      <BarCommand
        compact={compact}
        label="↓ Back"
        mark={<ArrowLineDownIcon size={18} />}
        title="Send to back"
        onClick={onSendToBack}
      />
      <div className="mx-1 h-4 w-px bg-foreground/10" />
      <BarCommand
        compact={compact}
        label="Delete"
        mark={<TrashIcon size={18} />}
        title="Delete selected (Del)"
        tone="text-destructive hover:bg-destructive/10"
        onClick={onDeleteSelection}
      />
    </div>
  );
}

export function CanvasOverlays({
  compact,
  transforming,
  scope,
  onLeaveScope,
  presenting,
  onPresent,
  onGroup,
  onUngroup,
  canUngroup,
  projection,
  onProjectionChange,
  selection,
  toolState,
  pickerOpen,
  onToolChange,
  onToolDoubleClick,
  onBringToFront,
  onSendToBack,
  onDeleteSelection,
  onPickNode,
  onClosePicker,
  gizmo,
  onGizmoChange,
}: CanvasOverlaysProps) {
  return (
    <>
      <CanvasToolbar
        compact={compact}
        projection={projection}
        onProjectionChange={onProjectionChange}
        toolState={toolState}
        onToolChange={onToolChange}
        onToolDoubleClick={onToolDoubleClick}
      />

      {scope !== null && <ScopeChip scope={scope} onLeave={onLeaveScope} />}

      {presenting !== null && !transforming && (
        <PresentBar compact={compact} presenting={presenting} onPresent={onPresent} />
      )}

      {presenting === null && !transforming && !selectionEmpty(selection) && (
        <SelectionBar
          compact={compact}
          count={selection.nodeIds.size + selection.edgeIds.size}
          canGroup={selection.nodeIds.size > 0}
          canUngroup={canUngroup}
          gizmo={selection.nodeIds.size > 0 ? gizmo : null}
          onGizmoChange={onGizmoChange}
          onGroup={onGroup}
          onUngroup={onUngroup}
          onBringToFront={onBringToFront}
          onSendToBack={onSendToBack}
          onDeleteSelection={onDeleteSelection}
        />
      )}

      {pickerOpen && <NodePicker onPick={onPickNode} onClose={onClosePicker} />}
    </>
  );
}
