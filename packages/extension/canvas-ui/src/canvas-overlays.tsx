import type { CanvasNode, CanvasProjectionKind } from "@kb/canvas";
import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react";
import type { PresentAct } from "./canvas-keymap";
import { frameName } from "./canvas-frame-name";
import { CanvasToolbar } from "./canvas-toolbar";
import { NodePicker } from "./node-picker";
import type { CanvasSelection } from "./canvas-selection";
import { selectionEmpty } from "./canvas-selection";
import type { CanvasTool, ToolState } from "./canvas-tool";
import { GIZMO_MODES, type GizmoChoice } from "./canvas-gizmo";
import { cn } from "@kb/ui-sdk";

/** Where present mode stands: the frame shown, by its place among how many. */
interface PresentingAt {
  at: number;
  frames: number;
  frame: CanvasNode | undefined;
}

interface CanvasOverlaysProps {
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
  presenting,
  onPresent,
}: {
  presenting: PresentingAt;
  onPresent: (act: PresentAct) => void;
}) {
  const { at, frames, frame } = presenting;
  const step = "rounded-md p-1 text-foreground/60 hover:bg-foreground/5 disabled:opacity-30";
  return (
    <div
      className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg whitespace-nowrap border border-foreground/10 bg-popover/95 px-2 py-1.5 shadow-floating backdrop-blur-sm"
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

/** One of the selection toolbar's plain buttons. */
const barButton = "rounded-md px-1.5 py-1 text-label text-foreground/60 hover:bg-foreground/5";

/**
 * The floating selection toolbar: in 3D the gizmo's switches, then group
 * or ungroup, reorder, delete. What it looks like is the docked style
 * panel's (`CanvasStylePanel`).
 */
function SelectionBar({
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
    <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg whitespace-nowrap border border-foreground/10 bg-popover/95 px-2 py-1.5 shadow-floating backdrop-blur-sm">
      <span className="mr-1 text-label text-foreground/40">{count} selected</span>
      {gizmo !== null && <GizmoSwitches gizmo={gizmo} onGizmoChange={onGizmoChange} />}
      {canGroup && (
        <button
          type="button"
          title="Group into a frame (⌘G)"
          className={barButton}
          onClick={onGroup}
        >
          Group
        </button>
      )}
      {canUngroup && (
        <button type="button" title="Ungroup (⌘⇧G)" className={barButton} onClick={onUngroup}>
          Ungroup
        </button>
      )}
      <button
        type="button"
        title="Bring to front"
        className="rounded-md px-1.5 py-1 text-label text-foreground/60 hover:bg-foreground/5"
        onClick={onBringToFront}
      >
        ↑ Front
      </button>
      <button
        type="button"
        title="Send to back"
        className="rounded-md px-1.5 py-1 text-label text-foreground/60 hover:bg-foreground/5"
        onClick={onSendToBack}
      >
        ↓ Back
      </button>
      <div className="mx-1 h-4 w-px bg-foreground/10" />
      <button
        type="button"
        title="Delete selected (Del)"
        className="rounded-md px-1.5 py-1 text-label text-destructive hover:bg-destructive/10"
        onClick={onDeleteSelection}
      >
        Delete
      </button>
    </div>
  );
}

export function CanvasOverlays({
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
        projection={projection}
        onProjectionChange={onProjectionChange}
        toolState={toolState}
        onToolChange={onToolChange}
        onToolDoubleClick={onToolDoubleClick}
      />

      {scope !== null && <ScopeChip scope={scope} onLeave={onLeaveScope} />}

      {presenting !== null && !transforming && (
        <PresentBar presenting={presenting} onPresent={onPresent} />
      )}

      {presenting === null && !transforming && !selectionEmpty(selection) && (
        <SelectionBar
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
