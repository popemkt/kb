import { Context, Layer, Effect } from "effect";
import { type SecretStore, UiHost, hostEntry } from "@kb/contracts";
import {
  routinesExtension,
  type SyncError,
  type AccountConfig,
  type CalendarBinding,
  type CalendarPort,
} from "@kb/routines";
import { routineActions } from "./actions.ts";
import { calendarBindingDigest } from "./binding.ts";
import { connections } from "./connections.ts";
import { RoutineGraph } from "./graph.ts";
import { RoutineEngine } from "./engine.ts";

/** One attempt at connecting an account: Google's consent page, and how it is finished. */
export interface ConnectStep {
  readonly url: string;
  /** What names this attempt in the redirect that finishes it. */
  readonly state: string;
  /** Finish with the URL Google sent the person back to. */
  readonly finish: (redirect: string) => Effect.Effect<void, SyncError>;
}
/** Whether the host can do the first setup steps itself (gcloud, signed in). */
export interface SetupAutomation {
  readonly installed: boolean;
  readonly account: string | null;
}
/**
 * What setting up a sync service asks of its provider (Google): check a
 * client before kb keeps it, connect an account, end a connection, and do
 * the first steps when the host can. Every call that resolves an account's
 * secrets is handed whether its binding is trusted.
 */
export interface ServiceSetup {
  readonly validate: (
    client: { readonly id: string; readonly secret: string },
    redirectUri: string,
  ) => Effect.Effect<void, SyncError>;
  readonly connect: (
    account: AccountConfig,
    trusted: Effect.Effect<boolean, SyncError>,
    redirectUri: string,
  ) => Effect.Effect<ConnectStep, SyncError>;
  readonly revoke: (
    account: AccountConfig,
    trusted: Effect.Effect<boolean, SyncError>,
  ) => Effect.Effect<void, SyncError>;
  readonly automation: Effect.Effect<SetupAutomation>;
  readonly automate: (project: string) => Effect.Effect<void, SyncError>;
}
export interface RoutinesPluginOptions {
  readonly client: (
    binding: CalendarBinding,
    trusted: Effect.Effect<boolean, SyncError>,
  ) => Effect.Effect<CalendarPort, SyncError>;
  readonly setup: ServiceSetup;
  /** Where the setup keeps a client and a refresh token a person handed it. */
  readonly secrets: SecretStore;
  readonly runner: string;
  /** The public origin: event backlinks, and the redirect URI Google sends the person back to. */
  readonly origin: string;
}
/**
 * The routines' host entry: the engine, run while `kb ui` runs, serving the
 * family's `sync` capability (`routinesExtension.host`) and its status
 * channel. Anywhere else it waits, pending, and does nothing.
 */
export function routinesPlugin(options: RoutinesPluginOptions) {
  return hostEntry(routinesExtension, {
    inject: [UiHost],
    apply: (host) =>
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const ui = yield* host.get(UiHost);
        const graphLayer = RoutineGraph.layer(ui);
        const graph = Context.get(yield* Layer.build(graphLayer), RoutineGraph);
        const engine = Context.get(
          yield* Layer.build(
            RoutineEngine.layer({
              ...options,
              client: (binding) =>
                options.client(
                  binding,
                  calendarBindingDigest(binding).pipe(Effect.flatMap(graph.trusted)),
                ),
            }).pipe(Layer.provide(Layer.succeed(RoutineGraph, graph))),
          ),
          RoutineEngine,
        );
        yield* host.serve(
          "sync",
          routineActions(engine, connections(options, ui, graph), options.setup, scope),
        );
        yield* host.channel("routines.status", {
          receive: (peer) =>
            engine.status().pipe(
              Effect.flatMap((status) => peer.send(status)),
              Effect.orElseSucceed(() => undefined),
            ),
          drop: () => Effect.void,
        });
        yield* engine.run;
      }),
  });
}
