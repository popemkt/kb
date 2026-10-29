import { useEffect, useRef } from "react";
import { useAppearance, useReducedMotion, type BackdropProps } from "@kb/ui-sdk";
import type { CompositionFactory } from "./composition";
import { useBackdropSeed } from "./seed";
import { readPalette } from "./tokens";
import { createStage, type Look, type Stage } from "./stage";

/** One frame's scene is allowed about this much of the main thread. */
const BUDGET_MS = 2;

/**
 * Hosts a composition (`composition.ts`) on a canvas that fills its frame:
 * decorative, with no hit targets, drawn only while visible and motion is
 * allowed (`createStage`). It feeds the stage what the page says: the look
 * (palette from the tokens and the head's colour, direction, strength) and
 * the owner's activity (`BackdropProps.activity`, and the `node` changing).
 */
export function SceneStage({
  factory,
  backdrop,
}: {
  factory: CompositionFactory;
  backdrop: BackdropProps;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const appearance = useAppearance();
  const reducedMotion = useReducedMotion();
  const seed = useBackdropSeed(reducedMotion);
  const { color, direction, strength, opacity, activity, node, pointer } = backdrop;
  const nodeId = node?.id;
  const { writes, editing } = activity;
  const seen = useRef({ writes, nodeId });
  // What a stage made later starts from: the page as it is now.
  const latest = useRef({ look: null as Look | null, editing });
  useEffect(() => {
    latest.current = {
      look: { palette: readPalette(appearance, color), direction, strength, presence: opacity },
      editing,
    };
  });

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return undefined;
    const made = createStage(element, factory(seed), {
      reducedMotion,
      pointer,
      budgetMs: BUDGET_MS,
    });
    stage.current = made;
    made.reactions.setEditing(latest.current.editing);
    if (latest.current.look !== null) made.look(latest.current.look);
    return () => {
      made.dispose();
      stage.current = null;
    };
  }, [factory, reducedMotion, seed, pointer]);

  useEffect(() => {
    stage.current?.look({
      palette: readPalette(appearance, color),
      direction,
      strength,
      presence: opacity,
    });
  }, [appearance, color, direction, strength, opacity]);

  useEffect(() => {
    const reactions = stage.current?.reactions;
    if (reactions === undefined) return;
    if (writes !== seen.current.writes) reactions.write();
    if (nodeId !== seen.current.nodeId) reactions.navigate();
    seen.current = { writes, nodeId };
    reactions.setEditing(editing);
  }, [writes, editing, nodeId]);

  return <canvas ref={canvas} className="kb-scene-canvas" data-scene-state="loading" />;
}
