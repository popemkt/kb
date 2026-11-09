/**
 * The first two setup steps done for the person when the host has the
 * Google Cloud CLI (`gcloud`) signed in: create the project when it does
 * not exist yet, and enable the Calendar API on it. kb only runs what a
 * person would type; it never signs gcloud in, and every other step (the
 * consent screen and the OAuth client) stays in the Console, where Google
 * offers no CLI for them.
 */
import { Effect, Result } from "effect";
import { SyncError } from "@kb/routines";

/** What one gcloud run answered. */
export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}
/** How gcloud is run on the host; a rejection is a gcloud that could not start. */
export type RunCommand = (argv: readonly string[]) => Promise<CommandResult>;

/** The APIs routines use, by their service name. */
export const GOOGLE_APIS = ["calendar-json.googleapis.com"] as const;

/** Whether the host can do the first steps: gcloud installed, and the account it is signed in as. */
export interface GcloudStatus {
  readonly installed: boolean;
  readonly account: string | null;
}

const ran = (run: RunCommand, argv: readonly string[]) =>
  Effect.tryPromise({
    try: () => run(argv),
    catch: () => new SyncError({ status: 0, code: "gcloud_missing" }),
  });

export const gcloudStatus = Effect.fn("routines.gcloud.status")(function* (run: RunCommand) {
  const answer = yield* Effect.result(ran(run, ["gcloud", "config", "get-value", "account"]));
  if (Result.isFailure(answer) || answer.success.code !== 0)
    return { installed: Result.isSuccess(answer), account: null } satisfies GcloudStatus;
  const account = answer.success.stdout.trim();
  return {
    installed: true,
    account: account === "" || account === "(unset)" ? null : account,
  } satisfies GcloudStatus;
});

/** What a failed `gcloud projects create` said, as kb's codes. */
function createFailure(stderr: string): string {
  if (/terms of service/i.test(stderr)) return "gcloud_terms";
  if (/already (in use|exists)|requested entity already exists/i.test(stderr))
    return "project_taken";
  if (/invalid|must be/i.test(stderr)) return "project_invalid";
  return "gcloud_failed";
}

/**
 * Create `project` unless it exists (and the signed-in account can see
 * it), then enable the routines APIs on it. Idempotent: run again, it
 * creates nothing and enables what is already enabled.
 */
export const gcloudSetup = Effect.fn("routines.gcloud.setup")(function* (
  run: RunCommand,
  project: string,
) {
  const status = yield* gcloudStatus(run);
  if (!status.installed) return yield* new SyncError({ status: 0, code: "gcloud_missing" });
  if (status.account === null)
    return yield* new SyncError({ status: 401, code: "gcloud_signed_out" });
  const described = yield* ran(run, [
    "gcloud",
    "projects",
    "describe",
    project,
    "--format=value(projectId)",
  ]);
  if (described.code !== 0) {
    const created = yield* ran(run, [
      "gcloud",
      "projects",
      "create",
      project,
      "--name=kb routines",
    ]);
    if (created.code !== 0)
      return yield* new SyncError({ status: 400, code: createFailure(created.stderr) });
  }
  const enabled = yield* ran(run, [
    "gcloud",
    "services",
    "enable",
    ...GOOGLE_APIS,
    `--project=${project}`,
  ]);
  if (enabled.code !== 0) return yield* new SyncError({ status: 400, code: "gcloud_failed" });
  return undefined;
});
