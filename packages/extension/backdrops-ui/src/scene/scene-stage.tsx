import { useCallback, useEffect, useRef } from "react";
import { SEED_KNOB, SPEED_KNOB } from "@kb/backdrops";
import { knobValue } from "@kb/model";
import { useAppearance, useReducedMotion, type BackdropProps } from "@kb/ui-sdk";
import type { CompositionFactory } from "./composition";
import { compositionKnobs, type Look } from "./look";
import { useBackdropSeed } from "./seed";
import { readPalette } from "./tokens";
import { useTellOwner } from "./owner";
import { createStage, type Stage } from "./stage";

/**
 * Hosts a composition (`composition.ts`) on a canvas that fills its frame:
 * decorative, with no hit targets, drawn only while visible and motion is
 * allowed (`createStage`). It feeds the stage what the page says: the look
 * (palette from the tokens and the head's colour, direction, strength, and
 * the composition's own knobs), the speed, and the owner's activity
 * (`BackdropProps.activity`, and the `node` changing).
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
  const { color, direction, strength, opacity, activity, node, pointer, budget, knobs } = backdrop;
  const seed = useBackdropSeed(reducedMotion, knobValue(knobs, SEED_KNOB));
  const speed = knobValue(knobs, SPEED_KNOB);
  const nodeId = node?.id;
  const { editing } = activity;
  // What a stage made later starts from: the page as it is now.
  const latest = useRef({ look: null as Look | null, editing, speed });
  useEffect(() => {
    latest.current = {
      look: {
        palette: readPalette(appearance, color),
        direction,
        strength,
        presence: opacity,
        knobs: compositionKnobs(knobs),
      },
      editing,
      speed,
    };
  });

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return undefined;
    const made = createStage(element, factory(seed), {
      reducedMotion,
      pointer,
      budgetMs: budget.frameMs,
    });
    stage.current = made;
    made.reactions.setEditing(latest.current.editing);
    made.setSpeed(latest.current.speed);
    if (latest.current.look !== null) made.look(latest.current.look);
    return () => {
      made.dispose();
      stage.current = null;
    };
  }, [factory, reducedMotion, seed, pointer, budget]);

  // A speed or seed moves the knobs too; the stage lays out again only for a look that differs.
  useEffect(() => {
    stage.current?.look({
      palette: readPalette(appearance, color),
      direction,
      strength,
      presence: opacity,
      knobs: compositionKnobs(knobs),
    });
  }, [appearance, color, direction, strength, opacity, knobs]);

  useEffect(() => stage.current?.setSpeed(speed), [speed]);

  const hears = useCallback(() => stage.current?.reactions ?? null, []);
  useTellOwner(hears, activity, nodeId);

  return <canvas ref={canvas} className="kb-scene-canvas" data-scene-state="loading" />;
}
