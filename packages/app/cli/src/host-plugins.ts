/**
 * The extensions `kb ui` hosts: the sidebar agent, over the adapters this
 * host implements (Claude Code through its SDK, and any OpenAI-compatible
 * chat endpoint). This file is the CLI's composition root for extensions,
 * the one file of this package that may import an extension package
 * (`EXTENSION_ROOTS` in `harness/src/constraints.ts`); the server names none
 * (DESIGN.md → Plugin channels). Each is handed over with its declaration:
 * the server composes it while its store has it on (`familyOn`, the switch
 * every family has, written by `extension.switch`) and reports it in
 * `kb.manifest` beside the registry's, and the page offers the agent only
 * while it is reported on. They load on demand, so no other command pays
 * for the agent packages. A key a provider refers to is read from this
 * process's environment, the platform keychain or the sealed store
 * (`systemSecrets`), and a key routines' setup is handed is kept there.
 */
import { Effect } from "effect";
import type { AccountConfig, CalendarBinding, SyncError as RoutineSyncError } from "@kb/routines";
import type { AgentAdapter } from "@kb/agent";
import type { ExtensionEntry } from "@kb/contracts";
import { childProcessEnv, systemSecrets } from "@kb/runtime";

/** The adapter for each of `AGENT_ADAPTERS`, running in `root`; the test holds it to every one. */
export const hostAgentAdapters = Effect.fn("kb.cli.hostAgentAdapters")(function* (
  root: string,
): Effect.fn.Return<readonly AgentAdapter[]> {
  const [{ CLAUDE_VARIABLES, claudeAdapter }, { openAiChatAdapter }] = yield* Effect.promise(() =>
    Promise.all([import("@kb/agent-claude"), import("@kb/agent-openai")]),
  );
  // Claude Code's environment is an agent's, with the person's login it declares it reads.
  const env = childProcessEnv("agent", {}, CLAUDE_VARIABLES);
  return [claudeAdapter({ cwd: root, env }), openAiChatAdapter()];
});

/** gcloud is the person's own tool, run as their shell would, never asked to prompt. */
function gcloud(argv: readonly string[]) {
  const child = Bun.spawn([...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: childProcessEnv("tool", { CLOUDSDK_CORE_DISABLE_PROMPTS: "1" }),
    timeout: 120_000,
  });
  return Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, code]) => ({ code, stdout, stderr }));
}

export const hostExtensions = Effect.fn("kb.cli.hostExtensions")(function* (
  root: string,
  origin = "http://127.0.0.1:4321",
): Effect.fn.Return<readonly ExtensionEntry[]> {
  const { agentExtension, agentPlugin } = yield* Effect.promise(() => import("@kb/agent"));
  const adapters = yield* hostAgentAdapters(root);
  const [
    { routinesExtension, SyncError },
    { routinesPlugin },
    {
      makeGoogleCalendar,
      makeGoogleTokens,
      beginGoogleConnect,
      validateGoogleClient,
      revokeGoogle,
      gcloudStatus,
      gcloudSetup,
    },
    { parseSecretRef },
  ] = yield* Effect.promise(() =>
    Promise.all([
      import("@kb/routines"),
      import("@kb/routines-host"),
      import("@kb/routines-gcal"),
      import("@kb/model"),
    ]),
  );
  const runner = crypto.randomUUID();
  const secrets = systemSecrets();
  const sink = (reference: string) => {
    const parsed = parseSecretRef(reference);
    if (parsed === null) throw new SyncError({ status: 401, code: "auth_needed" });
    return secrets.sink(parsed);
  };
  const oauth = (account: AccountConfig, trusted: Effect.Effect<boolean, RoutineSyncError>) => ({
    account,
    trusted,
    secrets,
    sink,
  });
  const accountOf = (calendar: CalendarBinding) => {
    if (calendar.account === null) throw new SyncError({ status: 401, code: "auth_needed" });
    return calendar.account;
  };
  return [
    {
      declaration: agentExtension,
      entry: agentPlugin({ adapters, secrets }),
    },
    {
      declaration: routinesExtension,
      entry: routinesPlugin({
        origin,
        runner,
        secrets,
        client: (calendar, trusted) =>
          makeGoogleTokens(oauth(accountOf(calendar), trusted)).pipe(
            Effect.map((tokens) => makeGoogleCalendar({ tokens, runner })),
          ),
        setup: {
          validate: (client, redirectUri) => validateGoogleClient(client, redirectUri),
          connect: (account, trusted, redirectUri) =>
            beginGoogleConnect(oauth(account, trusted), redirectUri),
          revoke: (account, trusted) => revokeGoogle(oauth(account, trusted)),
          automation: gcloudStatus(gcloud),
          automate: (project) => gcloudSetup(gcloud, project),
        },
      }),
    },
  ];
});
