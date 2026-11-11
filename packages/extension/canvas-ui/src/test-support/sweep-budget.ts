/**
 * The time budget of a canvas-ui test whose work is a sweep: thousands of
 * picks or ray samples over a grid or a random set, each a real call into
 * the camera or three.js. Vitest's 5 s default is a quiet machine's measure,
 * and a loaded one stretches a sweep past it: under 8 workers on one core,
 * the hit-test march took 5.8 s and the gizmo's reach sweep 15.3 s, where
 * alone they take 0.8 s and 1.8 s. This is the budget `bun test` gives every
 * test (the root `test` script's `--timeout`), so a sweep fails for what it
 * finds, or for hanging, and not for the load it ran under.
 */
export const SWEEP_BUDGET_MS = 30_000;
