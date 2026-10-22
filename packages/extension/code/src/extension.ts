/**
 * The code family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The declaration is the one home of the family's
 * name, seed and views; the bundled seed folds it, and both hosts load
 * {@link codePlugin}, so the key, the seed and the text cannot differ
 * between them. The family has no server-only package: its figure asks the
 * host's core references for an engine and an invoke core, and only the
 * runtime binds them, so on the page it draws the text alone. It is optional
 * and on by default.
 */
import { Effect } from "effect";
import {
  ActionPoint,
  declarationPlugin,
  defineExtension,
  extensionNamespace,
  guardAction,
  madeByScript,
  provideAction,
  viewDef,
  type ActionGuard,
  familyTags,
} from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";
import { SCRIPT_LIST } from "./list.ts";
import { SCRIPT_RUN } from "./run.ts";
import { codeSeedNodes } from "./seed.ts";
import { codeText } from "./text.ts";
import { CodeView } from "./view.ts";

export const codeExtension = defineExtension({
  name: "code",
  label: "Code",
  tags: ["code"],
  optional: { byDefault: "on" },
  seed: codeSeedNodes,
  views: [viewDef(CodeView, codeText)],
});

/**
 * A run is a person's act or an agent's: code never starts one, so a script
 * cannot chain runs of itself or of others. The family's own rule about its
 * own action, so it is the family's guard, held whether or not any policy
 * governs calls.
 */
const scriptRunGuard: Omit<ActionGuard, "match"> = {
  before: ({ invocation }) =>
    Effect.succeed(
      madeByScript(invocation)
        ? {
            decision: "deny",
            rule: "script-run",
            message: `action ${invocation.id} is never started by sandboxed code: a run is a person's act, or an agent's`,
          }
        : { decision: "allow" },
    ),
};

/**
 * The code family's shared plugin: its actions, its guard on running a
 * script, and its declaration's views, text included. It is the server's entry as it is, and the page's
 * entry loads it as a child; the page sends its actions to the server,
 * where code runs.
 */
export function codePlugin(): Plugin {
  return definePlugin({
    name: codeExtension.name,
    tags: familyTags(codeExtension),
    namespace: extensionNamespace(codeExtension.name),
    apply: (ctx) =>
      Effect.all(
        [
          // Its actions, `ext.code.*`: listing scripts and running one once.
          Effect.forEach(
            [SCRIPT_LIST, SCRIPT_RUN],
            (action) => ctx.contribute(ActionPoint, provideAction(action)),
            { discard: true },
          ),
          guardAction(ctx, `${ctx.namespace}.${SCRIPT_RUN.id}`, scriptRunGuard, "script-run"),
          ctx.plugin(declarationPlugin(codeExtension)),
        ],
        { discard: true },
      ),
  });
}
