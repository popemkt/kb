import { Clock, Effect, type Scope } from "effect";
import { onWire, type UiHostService } from "@kb/contracts";
import { readAccount, readCalendar, ROUTINE_FIELDS as F, SyncError } from "@kb/routines";
import { calendarBindingDigest } from "./binding.ts";
import type { RoutineHost } from "./graph.ts";
import type { ConnectStep, RoutinesPluginOptions } from "./plugin.ts";

export function connections(options: RoutinesPluginOptions, ui: UiHostService, host: RoutineHost) {
  const connecting = new Map<string, { digest: string; step: ConnectStep; at: number }>();
  const bindingFor = Effect.fn("routines.binding.read")(function* (id: string) {
    const nodes = yield* host.read;
    const node = nodes.get(id);
    if (node === undefined) return yield* new SyncError({ status: 404, code: "not_found" });
    return yield* Effect.try({
      try: () => {
        const calendar = readCalendar(node);
        const account = nodes.get(calendar.account);
        return { calendar, account: account === undefined ? null : readAccount(account) };
      },
      catch: () => new SyncError({ status: 400, code: "invalid_binding" }),
    });
  });
  const connect = Effect.fn("routines.connect")(function* (
    id: string,
  ): Effect.fn.Return<{ url: string }, SyncError, Scope.Scope> {
    const binding = yield* bindingFor(id);
    const digest = yield* calendarBindingDigest(binding);
    const existing = connecting.get(id);
    const at = yield* Clock.currentTimeMillis;
    if (existing !== undefined && existing.at + 600_000 > at)
      return yield* new SyncError({ status: 409, code: "connect_in_progress" });
    const step = yield* options.connect(binding, host.trusted(digest));
    connecting.set(id, { digest, step, at });
    return { url: step.url };
  });
  const finish = Effect.fn("routines.finish")(function* (id: string, redirect?: string) {
    const pending = connecting.get(id);
    if (pending === undefined) return yield* new SyncError({ status: 400, code: "connect_first" });
    const binding = yield* bindingFor(id);
    const digest = yield* calendarBindingDigest(binding);
    if (pending.digest !== digest)
      return yield* new SyncError({ status: 409, code: "binding_changed" });
    if (!(yield* host.trusted(digest)))
      return yield* new SyncError({ status: 403, code: "untrusted" });
    yield* pending.step.finish(redirect);
    connecting.delete(id);
    const client = yield* options.client(binding, host.trusted(digest));
    if (binding.calendar.calendarId === "") {
      const calendarId = yield* client.create("kb routines", binding.calendar.zone);
      const receipt = yield* ui.invoke(
        onWire(
          { actor: "agent", carriesApproval: false },
          {
            id: "node.update",
            via: "ext.routines.connect",
            input: {
              id,
              unsetProps: [{ field: F.calendarId }],
              setProps: [{ field: F.calendarId, value: { t: "str", v: calendarId } }],
            },
          },
        ),
      );
      if (receipt.status === "failed")
        return yield* new SyncError({ status: 500, code: "graph_unavailable" });
    }
    return { digest: yield* calendarBindingDigest(yield* bindingFor(id)) };
  });
  return { bindingFor, connect, finish };
}
export type Connections = ReturnType<typeof connections>;
