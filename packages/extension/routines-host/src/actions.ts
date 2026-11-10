import { Effect, Scope } from "effect";
import { z } from "zod";
import type { ActionMode, ExtensionAction } from "@kb/contracts";
import { domainError } from "@kb/model";
import { PROJECT_ID, type SyncError } from "@kb/routines";
import type { Connections } from "./connections.ts";
import type { RoutineEngine } from "./engine.ts";
import type { ServiceSetup } from "./plugin.ts";

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
/** A write only a person makes: connecting, keeping a credential, creating in Google. */
const personal: ActionMode = { kind: "write", outsideRoot: true, approval: "required" };
const accountInput = z.object({ account: z.string() });
const calendarInput = z.object({ calendar: z.string() });
const emptyInput = z.object({});
const ok = (work: Effect.Effect<unknown, SyncError>) => work.pipe(Effect.as({ ok: true }));
export function routineActions(
  engine: Effect.Success<typeof RoutineEngine>,
  connection: Connections,
  setup: ServiceSetup,
  scope: Scope.Scope,
): ExtensionAction[] {
  const definitions = [
    action(
      "preview",
      "Preview projected events without Google",
      read,
      emptyInput,
      () => engine.preview,
    ),
    action("status", "Read event sync status", read, emptyInput, engine.status),
    action(
      "setup",
      "Read what setting up a sync service needs here: the redirect URI, where secrets are kept, gcloud",
      read,
      emptyInput,
      () => connection.info,
    ),
    action(
      "binding",
      "Read the trust digest of a calendar's or an account's binding",
      read,
      z.object({ node: z.string() }),
      ({ node }: { node: string }) =>
        connection.digestOf(node).pipe(Effect.map((digest) => ({ digest }))),
    ),
    action(
      "automate",
      "Create the Google Cloud project and enable the Calendar API with the host's gcloud",
      personal,
      z.object({ project: z.string().regex(PROJECT_ID) }),
      ({ project }: { project: string }) => ok(setup.automate(project)),
    ),
    action(
      "client",
      "Check an OAuth client with Google and keep it in the host's secret store",
      personal,
      accountInput.extend({ clientId: z.string(), clientSecret: z.string() }),
      ({
        account,
        clientId,
        clientSecret,
      }: {
        account: string;
        clientId: string;
        clientSecret: string;
      }) => connection.saveClient(account, { id: clientId.trim(), secret: clientSecret.trim() }),
    ),
    action(
      "connect",
      "Start connecting an account to Google (its consent page)",
      personal,
      accountInput,
      ({ account }: { account: string }) => connection.connect(account),
    ),
    action(
      "finish",
      "Finish connecting with the URL Google sent the person back to",
      personal,
      z.object({ redirect: z.string() }),
      ({ redirect }: { redirect: string }) => connection.finish(redirect),
    ),
    action(
      "provision",
      "Create a calendar's own Google calendar",
      personal,
      calendarInput,
      ({ calendar }: { calendar: string }) => connection.provision(calendar),
    ),
    action(
      "remove",
      "Disconnect an account: revoke it at Google and erase what this host kept for it",
      personal,
      accountInput,
      ({ account }: { account: string }) => connection.remove(account),
    ),
    action("sync", "Retry event sync now", write, emptyInput, () => ok(engine.syncNow())),
    action(
      "release",
      "Release these held deletion plans",
      write,
      z.object({ keys: z.array(z.string()) }),
      ({ keys }: { keys: string[] }) => ok(engine.release(keys)),
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
