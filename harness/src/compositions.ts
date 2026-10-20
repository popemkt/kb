/**
 * kb's own plugin compositions, as each host's kernel holds them
 * (DESIGN.md → Plugin organisation): every plugin with its tags and what it
 * injects that nobody provides, and the dependencies the kernel derives.
 *
 * The harness reads the code, not the packages, so it composes nothing
 * itself. Each composition is read by a probe run with Bun from inside the
 * package that composes it, so the probe resolves that package's
 * dependencies as the package does and loads the very values its host
 * loads:
 *
 * - `registry`: the session registry over a fresh root with every optional
 *   family switched on, so every bundled family's plugin is loaded;
 * - `server`: the `kb ui` server's own kernel, as `startUi` composes it,
 *   with both identity providers and the hosted agent;
 * - `browser`: the page's kernel with the shell's plugins and every
 *   family's browser entry.
 */
import { join } from "node:path";
import { PACKAGES_ROOT } from "./workspace.ts";

interface ComposedPlugin {
  readonly name: string;
  readonly tags: readonly string[];
  readonly missing: readonly string[];
  readonly status: string;
}

export interface Composition {
  readonly plugins: readonly ComposedPlugin[];
  readonly dependencies: readonly { from: string; to: string; service: string }[];
}

export const COMPOSITIONS = ["registry", "server", "browser"] as const;
export type CompositionName = (typeof COMPOSITIONS)[number];

/** What every probe prints of the kernel it composed. */
const REPORT = `
const report = (kernel) => console.log(JSON.stringify({
  plugins: kernel.plugins().map(({ name, tags, missing, status }) => ({ name, tags, missing, status })),
  dependencies: kernel.dependencies(),
}));
const { Effect } = await import("effect");
const { mkdtemp } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const root = await mkdtemp(join(tmpdir(), "kb-composition-"));
`;

const PROBES: Readonly<Record<CompositionName, { cwd: string; code: string }>> = {
  registry: {
    cwd: "app/runtime",
    code: `${REPORT}
const { BUNDLED_FAMILIES } = await import("@kb/bundled");
const { invoke, kbRuntimeLayer, openKb, sessionRegistry } = await import("@kb/runtime");
const ctx = await openKb(root);
for (const { name, optional } of BUNDLED_FAMILIES) {
  if (optional === undefined) continue;
  const receipt = await invoke(ctx, { id: "extension.switch", input: { name, on: true }, actor: "cli" });
  if (receipt.status !== "succeeded") throw new Error(name + ": " + JSON.stringify(receipt));
}
const registry = await Effect.runPromise(sessionRegistry(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx))));
report(registry.kernel);
`,
  },
  server: {
    cwd: "app/cli",
    code: `${REPORT}
const { makeKernel } = await import("@kb/plugin");
const { NO_SECRETS } = await import("@kb/contracts");
const { agentExtension, agentPlugin } = await import("@kb/agent");
const { openKb } = await import("@kb/runtime");
const server = process.cwd() + "/../server/src/";
const { SubscriptionHub } = await import(server + "session.ts");
const { channelsOf, loadServerPlugins } = await import(server + "plugins.ts");
const { identityHeaderIdentity, pageTokenIdentity } = await import(server + "auth.ts");
const ctx = await openKb(root);
const kernel = makeKernel();
const hub = new SubscriptionHub(ctx, channelsOf(kernel));
await Effect.runPromise(
  loadServerPlugins(
    kernel,
    ctx,
    hub.screens,
    [{ declaration: agentExtension, entry: agentPlugin({ adapters: [], secrets: NO_SECRETS }) }],
    [pageTokenIdentity(), identityHeaderIdentity({ header: "X-Login", people: ["p"] })],
  ),
);
report(kernel);
hub.dispose();
`,
  },
  browser: {
    cwd: "app/ui",
    code: `${REPORT}
const { makeKernel } = await import("@kb/plugin");
const { BROWSER_EXTENSIONS, CORE_UI_PLUGINS } = await import(process.cwd() + "/src/ui-plugins.ts");
const kernel = makeKernel();
const entries = Object.values(BROWSER_EXTENSIONS).filter((entry) => entry !== null);
for (const plugin of [...CORE_UI_PLUGINS, ...(await Promise.all(entries.map((entry) => entry.load())))]) {
  await Effect.runPromise(Effect.exit(kernel.load(plugin)));
}
report(kernel);
`,
  },
};

/** Run the probe for `name` and read the kernel it composed. */
export function composition(name: CompositionName): Composition {
  const probe = PROBES[name];
  const run = Bun.spawnSync([process.execPath, "-e", probe.code], {
    cwd: join(PACKAGES_ROOT, probe.cwd),
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = run.stdout.toString().trim().split("\n").at(-1) ?? "";
  if (run.exitCode !== 0 || !out.startsWith("{")) {
    throw new Error(`the ${name} probe failed (${run.exitCode}): ${run.stderr.toString()}`);
  }
  return JSON.parse(out) as Composition;
}
