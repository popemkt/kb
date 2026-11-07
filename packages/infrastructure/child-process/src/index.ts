export { KB_LAUNCH_FLAGS } from "./kb-launch.ts";
/**
 * The environment of a process kb starts, the one place it is decided. A
 * child is given what its kind needs of this process's environment as it is
 * now, plus explicit overrides (mandatory per-kind settings win); Bun hands a child the environment the
 * process started with unless it is given one, so a variable set since (the
 * home store a test names in `KB_HOME`, say) would not reach it otherwise.
 *
 * - `kb`: a kb process over a root, such as the `kb ui` a location's open
 *   starts. It gets what any program needs to run (the base) and kb's own
 *   settings (`KB_*`, and `XDG_*` where the home store lives on Linux), and
 *   whether this is a test run (`NODE_ENV`), so a kb child of a test run
 *   that names no home of its own fails as its parent would rather than
 *   resolve the person's (DESIGN.md → Locations); and nothing else: a root
 *   someone else wrote may name an `env:` credential, so no key of this
 *   process's reaches a server over it.
 * - `lookup`: a keychain or secret-service lookup. The base, and the session
 *   bus the freedesktop secret service answers on.
 * - `agent`: the agent runtime kb hosts for the person (Claude Code, under
 *   the sidebar agent). The base, and what its adapter declares the runtime
 *   reads (`declared`: where it keeps its state, the network it reaches
 *   through, the person's login), and nothing else: the person's own login
 *   is the adapter's to name, and the adapter's to pass on only to a
 *   provider that uses that login.
 * - `git`: source transport. The base, SSH agent, proxies and CA paths;
 *   credential prompts and implicit lazy fetch are disabled. It runs in
 *   POSIX mode so the transport's file budget uses 512-byte blocks.
 * - `tool`: the person's own developer tool kb runs for them (Vite, under
 *   `kb ui --dev`), which runs as their shell would: the whole environment.
 */
export type ChildKind = "kb" | "lookup" | "agent" | "tool" | "git";

/** What any program needs to run as this user. */
const BASE = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TZ", "LANG", "TERM"];
const BASE_PREFIXES = ["LC_"];

type ChildPolicy = (
  | { readonly inherit: "all" }
  | {
      readonly inherit: "selected";
      readonly names: readonly string[];
      readonly prefixes: readonly string[];
    }
) & { readonly force?: Readonly<Record<string, string>> };
const POLICIES: Readonly<Record<ChildKind, ChildPolicy>> = {
  tool: { inherit: "all" },
  kb: {
    inherit: "selected",
    names: [...BASE, "NODE_ENV"],
    prefixes: [...BASE_PREFIXES, "KB_", "XDG_"],
  },
  lookup: {
    inherit: "selected",
    names: [...BASE, "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"],
    prefixes: BASE_PREFIXES,
  },
  agent: { inherit: "selected", names: BASE, prefixes: BASE_PREFIXES },
  git: {
    inherit: "selected",
    force: {
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
      GIT_NO_LAZY_FETCH: "1",
      POSIXLY_CORRECT: "1",
    },
    names: [
      ...BASE,
      "SSH_AUTH_SOCK",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "GIT_SSL_CAINFO",
    ],
    prefixes: BASE_PREFIXES,
  },
};

/**
 * What a child of `kind` is given of this process's environment, with
 * explicit `overrides` before mandatory policy, and the variables the code it runs declares it reads
 * (`declared`: an adapter's login, say), which no kind keeps of its own.
 */
export function childProcessEnv(
  kind: ChildKind,
  overrides: Readonly<Record<string, string>> = {},
  declared: readonly string[] = [],
): Record<string, string> {
  const env: Record<string, string> = {};
  const policy = POLICIES[kind];
  const keep = (key: string) =>
    policy.inherit === "all" ||
    declared.includes(key) ||
    policy.names.includes(key) ||
    policy.prefixes.some((prefix) => key.startsWith(prefix));
  // oxlint-disable-next-line node/no-process-env -- a child's environment is this process's, by definition
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && keep(key)) env[key] = value;
  }
  return { ...env, ...overrides, ...policy.force };
}
