/**
 * A scene's clock at the owner's speed (the speed knob, `SPEED_KNOB`): the
 * one place both hosts, the GPU host (`gpu/gpu-scene.ts`) and the 2D stage
 * (`stage.ts`), turn a frame's time into the scene's. The reactions to the
 * owner keep the frame's own time; only the picture runs faster, slower or
 * not at all. The scene's time never runs back.
 */
export interface SceneClock {
  /** A frame of `dt` seconds passed: the seconds the scene moves by. */
  readonly advance: (dt: number) => number;
  readonly setSpeed: (speed: number) => void;
  /** Seconds the scene has moved since it started. */
  readonly elapsed: () => number;
}

export function sceneClock(speed = 1): SceneClock {
  let rate = Math.max(0, speed);
  let elapsed = 0;
  return {
    advance: (dt) => {
      const moved = dt * rate;
      elapsed += moved;
      return moved;
    },
    setSpeed: (next) => {
      rate = Math.max(0, next);
    },
    elapsed: () => elapsed,
  };
}
