/**
 * The example repository extension: one family with both halves, written
 * against `kb-ext-sdk` as its author would write it (DESIGN.md → Core
 * boundary & extensions → repository extensions). Its server entry
 * provides a service, loads a child plugin that injects it to answer an
 * action, and loads its declaration's plugin for its views; its declaration
 * names a backdrop, seeds a tag and claims the tag's rows for one of its
 * views; its page entry draws the board as a page and the note at a row,
 * adds a sidebar section, contributes the backdrop, metered by the kit's
 * frame meter, binds keys in the outline's contexts, and adds "Link to a
 * note…" to the node menu, a command and a picker step written as data
 * over the two query nodes and the field it seeds. It declares a field type,
 * stars, which stores as a number: its page entry draws a field of it as
 * five stars, and its server entry's commit guard holds every write to one
 * to a whole number from 1 to 5. Its files share a helper directory, so its
 * closure holds more than its two entries.
 */
import { Effect } from "effect";
import { writeExtensionEffect, trustExtensionEffect } from "./extension-files.ts";

/** The example's name: its file's, its namespace's and its node's. */
export const EXAMPLE = "example";

/** Its files under `.kb/extensions/`, by path. */
export const EXAMPLE_EXTENSION: Readonly<Record<string, string>> = {
  "lib/declaration.ts": `import {
  BACKDROP_OPTIONS,
  FIELD_TYPE_OPTIONS,
  NoParams,
  defineExtension,
  viewDef,
  viewKey,
  type KbNode,
  type SeedBackdrop,
} from "kb-ext-sdk";
import { STARS, STARS_TYPE } from "./stars.ts";

/** The example's page: a board, which its page half draws. */
export const BoardView = viewKey("example.board", "Example board", NoParams);

/** The view a \`#noted\` row is drawn as, which its page half draws at a row. */
export const NoteView = viewKey("example.note", "Example note", NoParams);

/** The tag it seeds, whose nodes are drawn as a note: \`example.<local id>\`, in its namespace. */
export const NOTED = "example.noted";

/** Its ref field, which "Link to a note…" adds the note picked to. */
export const LINKS = "example.f.links";

/** Its query nodes: the \`#noted\` nodes, which the picker offers, and the rows that are not one, where the command is offered. */
export const NOTES = "example.q.notes";
export const UNNOTED = "example.q.unnoted";

/** Its field of its own type, stars, which a row is rated by. */
export const RATING = "example.f.rating";

/** A node of the seed, made at \`at\`. */
const seeded = (at: string, id: string, text: string, props: KbNode["props"]): KbNode => ({
  id,
  text,
  props,
  children: [],
  createdAt: at,
  updatedAt: at,
});

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
  seed: (at): readonly KbNode[] => [
    seeded(at, NOTED, "noted", { "sys.f.type": [{ t: "ref", v: "sys.tag" }] }),
    seeded(at, LINKS, "links", {
      "sys.f.type": [{ t: "ref", v: "sys.field" }],
      "sys.f.fieldType": [{ t: "ref", v: "sys.ft.ref" }],
    }),
    seeded(at, RATING, "rating", {
      "sys.f.type": [{ t: "ref", v: "sys.field" }],
      "sys.f.fieldType": [{ t: "ref", v: STARS_TYPE }],
      "sys.f.cardinality": [{ t: "ref", v: "sys.cardinality.one" }],
    }),
    seeded(at, NOTES, "notes", {
      "sys.f.query": [
        {
          t: "str",
          v: \`[:find ?id :where [?t :node/id "\${NOTED}"] [?n :f/sys.f.type ?t] [?n :node/id ?id]]\`,
        },
      ],
    }),
    seeded(at, UNNOTED, "rows that are no note", {
      "sys.f.query": [
        {
          t: "str",
          v: \`[:find ?id :where [?n :node/id ?id] (not [?n :f/sys.f.type ?t] [?t :node/id "\${NOTED}"])]\`,
        },
      ],
    }),
  ],
  views: [
    viewDef(BoardView, { body: () => ["An example board."] }),
    viewDef(NoteView, { body: () => ["An example note."] }),
  ],
  // Its query nodes are filed under its own node, out of the outline's home.
  files: { "sys.extension.example": [NOTES, UNNOTED] },
  tagRowViews: { [NOTED]: NoteView },
  declaredOptions: [
    { kind: BACKDROP_OPTIONS, options: [Glow] },
    // Its type stores as a number, so the store, the CLI and datalog read it as one.
    {
      kind: FIELD_TYPE_OPTIONS,
      options: [{ id: STARS, label: "stars", chooses: [{ kind: FIELD_TYPE_OPTIONS, id: "number" }] }],
    },
  ],
});
`,
  "lib/stars.ts": `import { FIELD_TYPE_OPTIONS, type CommitCall, type NodeId, type PropValue } from "kb-ext-sdk";

/** The example's field type, as its declaration names it: \`example.<local id>\`. */
export const STARS = "example.stars";

/** Its option node, which a field's type slot names. */
export const STARS_TYPE = FIELD_TYPE_OPTIONS.prefix + STARS;

/** Why a value is no rating, or null: a rating is a whole number of stars, 1 to 5. */
export function starsError(value: PropValue): string | null {
  const whole = value.t === "num" && Number.isInteger(value.v) && value.v >= 1 && value.v <= 5;
  return whole ? null : "a rating is a whole number of stars, 1 to 5";
}

/** The type option a field names, as the commit will hold it. */
function typeOf(call: CommitCall, fieldId: NodeId): NodeId | undefined {
  const written = call.writes.find(({ after }) => after?.id === fieldId)?.after;
  const field = written ?? call.nodeOf(fieldId);
  const [type] = field?.props[FIELD_TYPE_OPTIONS.field] ?? [];
  return type?.t === "ref" ? type.v : undefined;
}

/** Why a commit writes a value no field of stars may hold, or null: only the values it adds are asked. */
export function starsRefusal(call: CommitCall): string | null {
  for (const { before, after } of call.writes) {
    for (const [fieldId, values] of Object.entries(after?.props ?? {})) {
      if (typeOf(call, fieldId) !== STARS_TYPE) continue;
      const held = new Set((before?.props[fieldId] ?? []).map((v) => JSON.stringify(v)));
      for (const value of values) {
        if (held.has(JSON.stringify(value))) continue;
        const error = starsError(value);
        if (error !== null) return \`\${fieldId}: \${error}\`;
      }
    }
  }
  return null;
}
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
  guardAction,
  provideAction,
  type ExtensionAction,
} from "kb-ext-sdk";
import { declaration } from "./lib/declaration.ts";
import { Greeter } from "./lib/greeter.ts";
import { starsRefusal } from "./lib/stars.ts";

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
        // A rating is held to its form on every surface: the page, the CLI, an agent.
        guardAction(
          ctx,
          "every write",
          {
            commit: (call) => {
              const refusal = starsRefusal(call);
              return Effect.succeed(
                refusal === null
                  ? { decision: "allow" as const }
                  : { decision: "deny" as const, rule: "example.stars", message: refusal },
              );
            },
          },
          "stars",
        ),
      ],
      { discard: true },
    ),
});
`,
  "example.page.tsx": `import { Effect, declarationPlugin, definePlugin } from "kb-ext-sdk";
import {
  BACKDROP_BUDGETS,
  BackdropPoint,
  CommandPoint,
  KeybindingPoint,
  PICKED,
  PaletteStepPoint,
  SidebarSectionPoint,
  ViewPoint,
  provideBackdrop,
  provideCommand,
  provideKeybinding,
  providePaletteStep,
  provideValueKind,
  provideView,
  ValueKindPoint,
  type ValueKindSpec,
  type ValueSurfaceProps,
  type ViewProps,
} from "kb-ext-sdk/page";
import {
  BoardView,
  Glow,
  LINKS,
  NOTES,
  NoteView,
  UNNOTED,
  declaration,
} from "./lib/declaration.ts";
import { GlowScene } from "./lib/glow.tsx";
import { STARS, starsError } from "./lib/stars.ts";

/** Its declaration, as the page half reads it too: a test seeds a page from it. */
export { declaration };

function Board() {
  return <section data-example="board">An example board</section>;
}

function Section() {
  return <nav data-example="section">Example</nav>;
}

/** A \`#noted\` row: the row's own text, as the outline drew it, set in a note. */
function Note({ host }: ViewProps<unknown>) {
  return <aside data-example="note" data-row={host.row?.id}>{host.row?.text}</aside>;
}

/** A rating's row of data: five stars, always shown, a press setting the rating. */
const STARS_SPEC: ValueKindSpec = {
  editor: "swatch",
  text: (value) => (value.t === "num" ? String(value.v) : ""),
  parse: (text) => {
    const value = { t: "num" as const, v: Number(text) };
    const error = starsError(value);
    return error === null ? { ok: true, value } : { ok: false, reason: error };
  },
  isBlank: (value) => value.t !== "num" || value.v === 0,
  layout: "stack",
  follow: () => null,
};

/** A rating: five stars, as many lit as it holds; a press on one sets it. */
function Stars({ value, spec, onEnd }: ValueSurfaceProps) {
  const held = value.t === "num" ? value.v : 0;
  return (
    <span data-example="stars" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={\`Rate \${n}\`}
          aria-pressed={n <= held}
          onClick={() => onEnd(spec.parse(String(n)), String(n))}
        >
          {n <= held ? "★" : "☆"}
        </button>
      ))}
    </span>
  );
}

/**
 * Its keys: Alt-↑ moves the row in both of the outline's contexts, each
 * taking a chord the outline holds by naming the binding it replaces; and
 * ⌘⇧Y on a selected row runs kb's own \`node.update\` on it, through the
 * page's invoke path and its guards.
 */
const KEYS = [
  provideKeybinding("move-up", {
    context: "outline.editing",
    chord: "Alt-ArrowUp",
    run: { intent: "move-up" },
    replaces: "outline.editing.line-up",
  }),
  provideKeybinding("move-up-selected", {
    context: "outline.selection",
    chord: "Alt-ArrowUp",
    run: { intent: "move-up" },
    replaces: "outline.selection.up",
  }),
  provideKeybinding("stamp", {
    context: "outline.selection",
    chord: "Mod-Shift-y",
    run: { action: "node.update", input: { text: "Stamped by the example" } },
  }),
];

/**
 * "Link to a note…", as data: offered on a row that is no note, it opens
 * the picker over the notes, and the note picked is added to the row's
 * \`links\` through kb's own \`node.update\`.
 */
const LINK_COMMAND = provideCommand("link", {
  label: "Link to a note…",
  icon: "link",
  group: "make",
  order: 70,
  when: UNNOTED,
  run: { step: "example.link" },
});
const LINK_STEP = providePaletteStep("link", {
  label: "Link to a note",
  placeholder: "Search the notes…",
  icon: "link",
  candidates: NOTES,
  commit: {
    action: "node.update",
    input: { setProps: [{ field: LINKS, value: { t: "ref", v: PICKED } }] },
  },
});

export default definePlugin({
  name: declaration.name,
  uses: [PaletteStepPoint.name],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(declarationPlugin(declaration)),
        ctx.contribute(CommandPoint, LINK_COMMAND),
        ctx.contribute(
          ValueKindPoint,
          provideValueKind(STARS, { icon: "star", spec: STARS_SPEC, Surface: Stars }),
        ),
        Effect.flatMap(ctx.point(PaletteStepPoint), (steps) => ctx.contribute(steps, LINK_STEP)),
        ctx.contribute(
          ViewPoint,
          provideView(BoardView, { placements: ["page"], sample: {}, Component: Board }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(NoteView, { placements: ["row"], sample: {}, Component: Note }),
        ),
        ctx.contribute(SidebarSectionPoint, { id: "section", value: { order: 90, Component: Section } }),
        ...KEYS.map((binding) => ctx.contribute(KeybindingPoint, binding)),
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
