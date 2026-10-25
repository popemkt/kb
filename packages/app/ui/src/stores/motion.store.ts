/**
 * The motion painter (DESIGN-UI.md → Motion options): the one owner of
 * `<html data-motion data-fx>` and of the motion properties it sets there.
 * It reads the motion in force from the graph, core's settings over the
 * shown theme's preset (`motionChoice`), and paints it on every change to
 * either and to the system painted. Until the graph has arrived it paints
 * nothing, so the page moves as its sheet and the OS say.
 */
import { designSystemOptionId, extensionNodeId, motionChoice, type MotionChoice } from "@kb/model";
import { create } from "zustand";
import { motionPaint } from "@/lib/motion-paint";
import { useDesignSystemStore } from "@/stores/design-system.store";
import { useGraphStore } from "@/stores/graph.store";

const CORE = extensionNodeId("core");

interface MotionState {
  /** The motion in force, as last painted; null until the graph has arrived. */
  readonly choice: MotionChoice | null;
}

export const useMotionStore = create<MotionState>(() => ({ choice: null }));

/** The properties the painter has set, so the next paint can clear them first. */
let written: readonly string[] = [];
let paintedKey = "";

/** The motion core's settings and the painted system's preset put in force now; null before the graph. */
export function currentMotion(): MotionChoice | null {
  const index = useGraphStore.getState().index;
  const system = useDesignSystemStore.getState().painted;
  if (index === null || system === "") return null;
  return motionChoice(
    index.getNode(CORE)?.props,
    index.getNode(designSystemOptionId(system))?.props,
  );
}

function paint(): void {
  if (typeof document === "undefined") return;
  const choice = currentMotion();
  if (choice === null) return;
  const key = JSON.stringify([useDesignSystemStore.getState().painted, choice]);
  if (key === paintedKey) return;
  paintedKey = key;
  const root = document.documentElement;
  for (const property of written) root.style.removeProperty(property);
  const style = document.defaultView?.getComputedStyle(root);
  const { attributes, properties } = motionPaint(
    choice,
    (token) => style?.getPropertyValue(token) ?? "",
  );
  for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value);
  for (const [name, value] of Object.entries(properties)) root.style.setProperty(name, value);
  written = Object.keys(properties);
  useMotionStore.setState({ choice });
}

/** Keep the page's motion painted; paints once now. Returns the unsubscribe. */
export function startMotion(): () => void {
  const unsubscribeGraph = useGraphStore.subscribe(paint);
  const unsubscribeSystem = useDesignSystemStore.subscribe(paint);
  paint();
  return () => {
    unsubscribeGraph();
    unsubscribeSystem();
  };
}
