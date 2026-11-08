/**
 * The example repository extension: one family with both halves, written
 * against `kb-ext-sdk` as its author would write it (DESIGN.md → Core
 * boundary & extensions → repository extensions). Its server entry
 * provides a service, loads a child plugin that injects it to answer an
 * action, and loads its declaration's plugin for its view; its declaration
 * names a backdrop; its page entry draws that view, adds a sidebar section
 * and contributes the backdrop, metered by the kit's frame meter. Its files share a helper
 * directory, so its closure holds more than its two entries.
 */
import { Effect } from "effect";
import { writeExtensionEffect, trustExtensionEffect } from "./extension-files.ts";

/** The example's name: its file's, its namespace's and its node's. */
export const EXAMPLE = "example";

/** Its files under `.kb/extensions/`, by path. */
export const EXAMPLE_EXTENSION: Readonly<Record<string, string>> = {
  "lib/declaration.ts": `import {
  BACKDROP_OPTIONS,
  NoParams,
  defineExtension,
  viewDef,
  viewKey,
  type SeedBackdrop,
} from "kb-ext-sdk";

/** The example's one view: a board, which its page half draws. */
export const BoardView = viewKey("example.board", "Example board", NoParams);

/** The example's backdrop: a glow drifting across the head, with two knobs. */
export const Glow: SeedBackdrop = {
  id: "example.glow",
  label: "Example glow",
  credit: "The example extension",
  strength: "soft",
  knobs: [
    { kind: "number", id: "speed", label: "Speed", min: 0, max: 2, step: 0.25, default: 1 },
    { kind: "color", id: "tint", label: "Tint", default: "#7cc4ff" },
  ],
};

export const declaration = defineExtension({
  name: "example",
  label: "Example",
  optional: { byDefault: "on" },
  views: [viewDef(BoardView, { body: () => ["An example board."] })],
  declaredOptions: [{ kind: BACKDROP_OPTIONS, options: [Glow] }],
});
`,
  "lib/glow.tsx": `import { useEffect, useRef } from "react";
import { meterFrames, useReducedMotion, type BackdropProps } from "kb-ext-sdk/page";

/**
 * The glow's scene: a radial gradient in the tint, drifting at the speed,
 * drawn on its own canvas and held to its budget by the kit's meter. Under
 * reduced motion it draws one still frame.
 */
export function GlowScene({ knobs, budget, opacity }: BackdropProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useReducedMotion();
  const speed = typeof knobs.speed === "number" ? knobs.speed : 1;
  const tint = typeof knobs.tint === "string" ? knobs.tint : "#7cc4ff";
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d") ?? null;
    if (element === null || context === null) return undefined;
    const meter = meterFrames(element, budget);
    let raf = 0;
    let t = 0;
    const draw = () => {
      const began = performance.now();
      // Drawn at its box's size, so it fills whatever frame the slot gives it.
      if (element.width !== element.clientWidth) element.width = element.clientWidth;
      if (element.height !== element.clientHeight) element.height = element.clientHeight;
      const { width, height } = element;
      const x = width * (0.5 + 0.35 * Math.sin(t));
      const gradient = context.createRadialGradient(x, height / 2, 0, x, height / 2, width * 0.4 * meter.quality());
      gradient.addColorStop(0, tint);
      gradient.addColorStop(1, "transparent");
      context.clearRect(0, 0, width, height);
      context.globalAlpha = opacity;
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      meter.record(performance.now() - began);
    };
    const tick = () => {
      t += 0.01 * speed;
      draw();
      raf = requestAnimationFrame(tick);
    };
    if (still) draw();
    else raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [budget, opacity, speed, still, tint]);
  return <canvas ref={canvas} data-example="glow" style={{ width: "100%", height: "100%" }} />;
}
`,
  "lib/greeter.ts": `import { Service } from "kb-ext-sdk";

export interface GreeterService {
  readonly greet: (name: string) => string;
}

/** The example's service: its server entry provides it, and its action injects it. */
export const Greeter = Service<GreeterService>()("ext.example.greeter");
`,
  "example.ts": `import {
  ActionPoint,
  Effect,
  declarationPlugin,
  definePlugin,
  extensionNamespace,
  provideAction,
  type ExtensionAction,
} from "kb-ext-sdk";
import { declaration } from "./lib/declaration.ts";
import { Greeter } from "./lib/greeter.ts";

export { declaration };

const named = {
  parse: (input: unknown) => {
    const name = (input as { name?: unknown } | null)?.name;
    return { name: typeof name === "string" ? name : "world" };
  },
};
const answered = { parse: (output: unknown) => output };

/** Its action, answered through the service: a plugin waits until what it injects exists. */
const greeting = definePlugin({
  name: "greeting",
  inject: [Greeter],
  apply: (ctx) =>
    Effect.gen(function* () {
      const greeter = yield* ctx.get(Greeter);
      const greet: ExtensionAction = {
        id: "greet",
        title: "Greet",
        description: "Greet someone through the example's service",
        mode: { kind: "read" },
        inputSchema: named,
        outputSchema: answered,
        handler: async (_ctx, input) => ({ message: greeter.greet((input as { name: string }).name) }),
      };
      yield* ctx.contribute(ActionPoint, provideAction(greet));
    }),
});

export default definePlugin({
  name: declaration.name,
  namespace: extensionNamespace(declaration.name),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.provide(Greeter, { greet: (name) => \`hello \${name}\` }),
        ctx.plugin(greeting),
        ctx.plugin(declarationPlugin(declaration)),
      ],
      { discard: true },
    ),
});
`,
  "example.page.tsx": `import { Effect, declarationPlugin, definePlugin } from "kb-ext-sdk";
import {
  BACKDROP_BUDGETS,
  BackdropPoint,
  SidebarSectionPoint,
  ViewPoint,
  provideBackdrop,
  provideView,
} from "kb-ext-sdk/page";
import { BoardView, Glow, declaration } from "./lib/declaration.ts";
import { GlowScene } from "./lib/glow.tsx";

/** Its declaration, as the page half reads it too: a test seeds a page from it. */
export { declaration };

function Board() {
  return <section data-example="board">An example board</section>;
}

function Section() {
  return <nav data-example="section">Example</nav>;
}

export default definePlugin({
  name: declaration.name,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(declarationPlugin(declaration)),
        ctx.contribute(
          ViewPoint,
          provideView(BoardView, { placements: ["page"], sample: {}, Component: Board }),
        ),
        ctx.contribute(SidebarSectionPoint, { id: "section", value: { order: 90, Component: Section } }),
        ctx.contribute(
          BackdropPoint,
          provideBackdrop(Glow, {
            presentation: {
              space: 48,
              height: 160,
              span: { reach: "region" },
              offset: 0,
              directions: [],
              opacity: { subtle: 0.35, soft: 0.6, vivid: 0.9 },
            },
            budget: BACKDROP_BUDGETS.canvas,
            interactions: [],
            Component: GlowScene,
          }),
        ),
      ],
      { discard: true },
    ),
});
`,
};

/** Write the example's files under `root`, without trusting it. */
export const writeExampleEffect = Effect.fn("test.writeExample")(function* (root: string) {
  for (const [file, source] of Object.entries(EXAMPLE_EXTENSION)) {
    yield* writeExtensionEffect(root, file, source);
  }
});

/** Write the example's files under `root` and trust its closure, as its owner would; its digest. */
export const writeTrustedExampleEffect = Effect.fn("test.writeTrustedExample")(function* (
  root: string,
) {
  yield* writeExampleEffect(root);
  return yield* trustExtensionEffect(root, `${EXAMPLE}.ts`);
});

export const writeTrustedExample = (root: string): Promise<string> =>
  Effect.runPromise(writeTrustedExampleEffect(root));
