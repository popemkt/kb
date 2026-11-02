import { Context, Layer, Predicate, Effect, type Scope } from "effect";
import {
  ActionPoint,
  ChannelPoint,
  UiHost,
  familyTags,
  provideAction,
  extensionNamespace,
} from "@kb/contracts";
import { definePlugin, PluginError } from "@kb/plugin";
import {
  routinesExtension,
  type SyncError,
  type CalendarBinding,
  type CalendarPort,
  type SyncLedger,
} from "@kb/routines";
import { routineActions } from "./actions.ts";
import { calendarBindingDigest } from "./binding.ts";
import { connections } from "./connections.ts";
import { RoutineGraph } from "./graph.ts";
import { RoutineEngine } from "./engine.ts";

export interface ConnectStep {
  readonly url: string;
  readonly finish: (pasted?: string) => Effect.Effect<void, SyncError>;
}
export interface RoutinesPluginOptions {
  readonly ledger: Effect.Effect<SyncLedger, SyncError, Scope.Scope>;
  readonly client: (
    binding: CalendarBinding,
    trusted: Effect.Effect<boolean, SyncError>,
  ) => Effect.Effect<CalendarPort, SyncError>;
  readonly connect: (
    binding: CalendarBinding,
    trusted: Effect.Effect<boolean, SyncError>,
  ) => Effect.Effect<ConnectStep, SyncError, Scope.Scope>;
  readonly runner: string;
  readonly origin: string;
}
export function routinesPlugin(options: RoutinesPluginOptions) {
  return definePlugin({
    name: routinesExtension.name,
    tags: familyTags(routinesExtension),
    inject: [UiHost],
    apply: (ctx) =>
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const ui = yield* ctx.get(UiHost);
        const graphLayer = RoutineGraph.layer(ui);
        const host = Context.get(yield* Layer.build(graphLayer), RoutineGraph);
        const ledger = yield* options.ledger;
        const engine = Context.get(
          yield* Layer.build(
            RoutineEngine.layer({
              ...options,
              ledger,
              client: (binding) =>
                options.client(
                  binding,
                  calendarBindingDigest(binding).pipe(Effect.flatMap(host.trusted)),
                ),
            }).pipe(Layer.provide(Layer.succeed(RoutineGraph, host))),
          ),
          RoutineEngine,
        );
        const actions = routineActions(engine, connections(options, ui, host, ledger), scope);
        yield* ctx.plugin(
          definePlugin({
            name: "actions",
            namespace: extensionNamespace(routinesExtension.name),
            tags: familyTags(routinesExtension),
            apply: (actionCtx) =>
              Effect.forEach(
                actions,
                (action) => actionCtx.contribute(ActionPoint, provideAction(action)),
                { discard: true },
              ),
          }),
        );
        yield* ctx.contribute(ChannelPoint, {
          id: "routines.status",
          value: {
            receive: (peer) =>
              engine.status().pipe(
                Effect.flatMap((status) => peer.send(status)),
                Effect.orElseSucceed(() => undefined),
              ),
            drop: () => Effect.void,
          },
        });
        yield* engine.run;
      }).pipe(
        Effect.mapError((error) =>
          Predicate.isTagged(error, "Routines/SyncError")
            ? new PluginError({
                plugin: routinesExtension.name,
                reason: "apply-failed",
                message: error.code,
              })
            : error,
        ),
      ),
  });
}
