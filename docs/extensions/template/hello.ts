/**
 * The smallest extension a marketplace lists: one read action. What it says
 * about itself lives in hello.manifest.json beside it, never here; the
 * declaration names it and nothing more. See docs/extensions/README.md.
 */
import {
  ActionPoint,
  Effect,
  defineExtension,
  definePlugin,
  extensionNamespace,
  provideAction,
} from "kb-ext-sdk";
import { z } from "zod";

export const declaration = defineExtension({ name: "hello", label: "Hello" });

export default definePlugin({
  name: declaration.name,
  namespace: extensionNamespace(declaration.name),
  apply: (ctx) =>
    ctx.contribute(
      ActionPoint,
      provideAction({
        id: "greet",
        title: "Say hello",
        description: "Greets whoever you name",
        mode: { kind: "read" },
        inputSchema: z.object({ name: z.string() }),
        outputSchema: z.string(),
        effect: ({ name }: { name: string }) => Effect.succeed(`Hello, ${name}`),
      }),
    ),
});
