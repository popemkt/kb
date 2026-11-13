/**
 * A family's host entry (DESIGN.md → Plugin channels → host entries): the
 * part of a family that runs only while a host runs, typed so that it can
 * add nothing but what a host is for. Its declaration names what it serves
 * (`ExtensionDeclaration.host`), and {@link hostEntry} gives its code a handle with no
 * other member: a channel, and the actions of a capability it declared.
 */
import { Effect, type Scope } from "effect";
import { definePlugin, PluginError, type Plugin, type ServiceKey } from "@kb/plugin";
import { ChannelPoint, type Channel } from "./channel.ts";
import { declarationPlugin, familyTags, type ExtensionDeclaration } from "./declaration.ts";
import {
  ActionPoint,
  extensionNamespace,
  provideAction,
  type ExtensionAction,
} from "./extension.ts";

/**
 * What a host entry's code is handed. It has no member that contributes an
 * ordinary action, provides a service or loads a plugin, so a host entry
 * cannot own anything every process must have.
 */
export interface HostEntryContext {
  /** A service the entry injects. */
  readonly get: <S>(key: ServiceKey<S>) => Effect.Effect<S, PluginError>;
  /** Own the live connection `id` (`ChannelPoint`), in the family's namespace. */
  readonly channel: (id: string, channel: Channel) => Effect.Effect<void, PluginError>;
  /** Serve the declared capability `name` with `actions`: exactly the actions it lists. */
  readonly serve: (
    name: string,
    actions: readonly ExtensionAction[],
  ) => Effect.Effect<void, PluginError>;
}

export interface HostEntrySpec {
  /** Services that must exist before `apply` runs: a host's (`UiHost`). */
  readonly inject?: readonly ServiceKey<unknown>[];
  readonly apply: (host: HostEntryContext) => Effect.Effect<void, PluginError, Scope.Scope>;
}

/**
 * `declaration`'s host entry: a plugin under its family's name that loads
 * the declaration's own plugin ({@link declarationPlugin}), as every entry
 * does, and runs `spec.apply` with a {@link HostEntryContext}. It serves a
 * capability only when the declaration's {@link HostPart} names it, and
 * only the actions that capability lists, each of them; anything else
 * fails the entry's load.
 */
export function hostEntry(declaration: ExtensionDeclaration, spec: HostEntrySpec): Plugin {
  const { name } = declaration;
  const refuse = (message: string) =>
    new PluginError({ plugin: name, reason: "invalid-contribution", message });
  return definePlugin({
    name,
    tags: familyTags(declaration),
    ...(spec.inject === undefined ? {} : { inject: spec.inject }),
    apply: (ctx) =>
      Effect.gen(function* () {
        yield* ctx.plugin(declarationPlugin(declaration));
        yield* spec.apply({
          get: (key) => ctx.get(key),
          channel: (id, channel) =>
            Effect.asVoid(ctx.contribute(ChannelPoint, { id, value: channel })),
          serve: (capability, actions) => {
            const declared = declaration.host?.capabilities.find(
              (each) => each.name === capability,
            );
            if (declared === undefined)
              return Effect.fail(refuse(`${name} declares no host capability ${capability}`));
            const served = actions.map((action) => action.id);
            const listed = new Set(declared.actions);
            const undeclared = served.filter((id) => !listed.has(id));
            const missing = declared.actions.filter((id) => !served.includes(id));
            if (undeclared.length > 0 || missing.length > 0)
              return Effect.fail(
                refuse(
                  `${name}'s host capability ${capability} lists [${declared.actions.join(", ")}] and was served [${served.join(", ")}]`,
                ),
              );
            return Effect.asVoid(
              ctx.plugin(
                definePlugin({
                  name: capability,
                  namespace: extensionNamespace(name),
                  tags: familyTags(declaration),
                  apply: (actionCtx) =>
                    Effect.forEach(
                      actions,
                      (action) => actionCtx.contribute(ActionPoint, provideAction(action)),
                      { discard: true },
                    ),
                }),
              ),
            );
          },
        });
      }),
  });
}
