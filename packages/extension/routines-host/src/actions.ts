import { Effect, Scope } from "effect";
import { z } from "zod";
import type { ActionMode, ExtensionAction } from "@kb/contracts";
import { domainError } from "@kb/model";
import type { SyncError } from "@kb/routines";
import { calendarBindingDigest } from "./binding.ts";
import type { Connections } from "./connections.ts";
import type { RoutineEngine } from "./engine.ts";

type Handler = (input: never) => Effect.Effect<unknown, SyncError, Scope.Scope>;
interface Definition extends Omit<ExtensionAction, "effect" | "handler"> {
  effect: Handler;
}
function action(
  id: string,
  title: string,
  mode: ActionMode,
  inputSchema: z.ZodType,
  effect: Handler,
): Definition {
  return { id, title, description: title, mode, inputSchema, outputSchema: z.unknown(), effect };
}
const read: ActionMode = { kind: "read" };
const write: ActionMode = { kind: "write", outsideRoot: true };
const calendarInput = z.object({ calendar: z.string() });
const keyInput = z.object({ key: z.string() });
const emptyInput = z.object({});
const ok = (work: Effect.Effect<unknown, SyncError>) => work.pipe(Effect.as({ ok: true }));
export function routineActions(
  engine: Effect.Success<typeof RoutineEngine>,
  connection: Connections,
  scope: Scope.Scope,
): ExtensionAction[] {
  const definitions = [
    action("preview", "Preview projected events without Google", read, emptyInput, engine.preview),
    action("status", "Read routine sync status and local log", read, emptyInput, engine.status),
    action(
      "binding",
      "Read calendar binding trust digest",
      read,
      calendarInput,
      ({ calendar }: { calendar: string }) =>
        connection.bindingFor(calendar).pipe(
          Effect.flatMap(calendarBindingDigest),
          Effect.map((digest) => ({ digest })),
        ),
    ),
    action(
      "connect",
      "Start Google desktop OAuth",
      write,
      calendarInput,
      ({ calendar }: { calendar: string }) => connection.connect(calendar),
    ),
    action(
      "finish",
      "Save authorization and create the app calendar",
      write,
      calendarInput.extend({ redirect: z.string().optional() }),
      ({ calendar, redirect }: { calendar: string; redirect?: string }) =>
        connection.finish(calendar, redirect),
    ),
    action("sync", "Retry routine sync now", write, emptyInput, () => ok(engine.syncNow())),
    action(
      "release",
      "Release these held deletion plans",
      write,
      z.object({ keys: z.array(z.string()) }),
      ({ keys }: { keys: string[] }) => ok(engine.release(keys)),
    ),
    action(
      "recreate",
      "Recreate a deleted Google event",
      write,
      keyInput,
      ({ key }: { key: string }) => ok(engine.recreate(key)),
    ),
    action(
      "resolve",
      "Resolve this conflict using kb",
      write,
      keyInput,
      ({ key }: { key: string }) => ok(engine.resolve(key)),
    ),
  ];
  return definitions.map((definition) => ({
    ...definition,
    effect: (value) =>
      definition.effect(value).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.mapError((error) => domainError("internal", error.code)),
      ),
  }));
}
