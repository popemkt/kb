/**
 * The example repository extension: one family with both halves, written
 * against `kb-ext-sdk` as its author would write it (DESIGN.md → Core
 * boundary & extensions → repository extensions). Its server entry
 * provides a service, loads a child plugin that injects it to answer an
 * action, and loads its declaration's plugin for its view; its page entry
 * draws that view and adds a sidebar section. Its files share a helper
 * directory, so its closure holds more than its two entries.
 */
import { Effect } from "effect";
import { writeExtensionEffect, trustExtensionEffect } from "./extension-files.ts";

/** The example's name: its file's, its namespace's and its node's. */
export const EXAMPLE = "example";

/** Its files under `.kb/extensions/`, by path. */
export const EXAMPLE_EXTENSION: Readonly<Record<string, string>> = {
  "lib/declaration.ts": `import { NoParams, defineExtension, viewDef, viewKey } from "kb-ext-sdk";

/** The example's one view: a board, which its page half draws. */
export const BoardView = viewKey("example.board", "Example board", NoParams);

export const declaration = defineExtension({
  name: "example",
  label: "Example",
  optional: { byDefault: "on" },
  views: [viewDef(BoardView, { body: () => ["An example board."] })],
});
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
import { SidebarSectionPoint, ViewPoint, provideView } from "kb-ext-sdk/page";
import { BoardView, declaration } from "./lib/declaration.ts";

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
