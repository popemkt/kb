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
 *   with the identity provider and the hosted agent;
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
  readonly parent: string | null;
  readonly error: string | null;
}

interface SwitchCase {
  readonly family: string;
  readonly composition: Composition;
  readonly predicted: readonly string[] | null;
  readonly internalReads: readonly string[];
}

export interface SwitchMatrix {
  readonly baseline: Composition;
  readonly cases: readonly SwitchCase[];
}

export interface Composition {
  readonly plugins: readonly ComposedPlugin[];
  readonly dependencies: readonly {
    from: string;
    to: string;
    kind: "service" | "point" | "contribution";
    name: string;
  }[];
}

export const COMPOSITIONS = ["registry", "server", "browser"] as const;
export type CompositionName = (typeof COMPOSITIONS)[number];

/** What every probe prints of the kernel it composed. */
const REPORT = `
const snapshot = (kernel) => ({
  plugins: kernel.plugins().map(({ name, parent, tags, missing, status, error }) => ({ name, parent, tags, missing, status, error: error?.message ?? null })),
  dependencies: kernel.dependencies(),
});
const { Effect } = await import("effect");
const output = (value) => console.log(JSON.stringify(value));
const runMatrix = async (names, compose, set, preview, reads) => {
  const baseline = snapshot(await compose());
  if (process.env.KB_COMPOSITION_MATRIX !== "1") return output(baseline);
  const cases = [];
  for (const family of names) {
    const predicted = preview === undefined ? null : await preview(family);
    await set(family, false);
    const composition = snapshot(await compose());
    const internalReads = reads === undefined ? [] : await reads();
    cases.push({ family, composition, predicted, internalReads });
    await set(family, true);
  }
  output({ baseline, cases });
};
const { mkdtemp } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const root = await mkdtemp(join(tmpdir(), "kb-composition-"));
process.env.KB_DATA = join(root, "data");
process.env.KB_HOME = join(root, "home");
`;

const PROBES: Readonly<Record<CompositionName, { cwd: string; code: string }>> = {
  registry: {
    cwd: "app/runtime",
    code: `${REPORT}
const { BUNDLED_FAMILIES } = await import("@kb/bundled");
const { invoke, kbRuntimeLayer, openKb, sessionRegistry } = await import("@kb/runtime");
const ctx = await openKb(root);
const call = (id, input) => invoke(ctx, { id, input, actor: "cli" });
const set = async (name, on) => {
  const receipt = await call("extension.switch", { name, on });
  if (receipt.status !== "succeeded") throw new Error(name + ": " + JSON.stringify(receipt));
};
const optional = BUNDLED_FAMILIES.filter(({ required }) => required === undefined).map(({ name }) => name);
for (const name of optional) await set(name, true);
const registry = () => Effect.runPromise(sessionRegistry(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx))));
await runMatrix(optional, async () => (await registry()).kernel, set, async (name) => {
  const receipt = await call("extension.impact", { name, on: false });
  if (receipt.status !== "succeeded") throw new Error(name + ": " + JSON.stringify(receipt));
  return receipt.output.pauses.map(({ plugin }) => plugin);
}, async () => {
  const internal = [];
  for (const { def } of (await registry()).actions) {
    if (def.mode.kind !== "read") continue;
    const receipt = await call(def.id, {});
    if (receipt.code === "internal") internal.push(def.id + ": " + receipt.message);
  }
  return internal;
});
`,
  },
  server: {
    cwd: "app/cli",
    code: `${REPORT}
const { makeKernel } = await import("@kb/plugin");
const { BUNDLED_FAMILIES } = await import("@kb/bundled");
const { hostExtensions } = await import(process.cwd() + "/src/host-plugins.ts");
const { kbRuntimeLayer, invokeReceiptEffect, openKb, sessionRegistry } = await import("@kb/runtime");
const server = process.cwd() + "/../server/src/";
const { SubscriptionHub } = await import(server + "session.ts");
const { channelsOf, loadServerPlugins } = await import(server + "plugins.ts");
const { identityHeaderIdentity } = await import(server + "auth.ts");
const ctx = await openKb(root);
const kernel = makeKernel({ host: "server" });
const hub = new SubscriptionHub(ctx, channelsOf(kernel));
const extensions = await Effect.runPromise(hostExtensions(root));
const hosted = await Effect.runPromise(
  loadServerPlugins(
    kernel,
    ctx,
    hub.screens,
    extensions,
    [identityHeaderIdentity({ header: "X-Login", people: ["p"] })],
  ),
);
const call = (id, input) => Effect.runPromise(invokeReceiptEffect(ctx, { id, input, actor: "cli" })
  .pipe(Effect.provide(kbRuntimeLayer(ctx, undefined, hosted))));
const set = async (name, on) => {
  const receipt = await call("extension.switch", { name, on });
  if (receipt.status !== "succeeded") throw new Error(name + ": " + JSON.stringify(receipt));
};
const optional = extensions.filter(({ declaration }) => declaration.required === undefined)
  .map(({ declaration }) => declaration.name);
for (const name of optional) await set(name, true);
if (process.env.KB_COMPOSITION_MATRIX === "1") {
  for (const { name, required } of BUNDLED_FAMILIES) {
    if (required === undefined) await set(name, true);
  }
}
await runMatrix(optional, async () => {
  await Effect.runPromise(hosted.converge);
  if (process.env.KB_COMPOSITION_MATRIX !== "1") return kernel;
  const registry = (await Effect.runPromise(sessionRegistry(ctx, kernel)
    .pipe(Effect.provide(kbRuntimeLayer(ctx, undefined, hosted))))).kernel;
  return {
    plugins: () => [...kernel.plugins(), ...registry.plugins()],
    dependencies: () => [...kernel.dependencies(), ...registry.dependencies()],
  };
}, set, async (name) => {
  const receipt = await call("extension.impact", { name, on: false });
  if (receipt.status !== "succeeded") throw new Error(name + ": " + JSON.stringify(receipt));
  return receipt.output.pauses.map(({ plugin }) => plugin);
});
await Effect.runPromise(kernel.shutdown);
hub.dispose();
`,
  },
  browser: {
    cwd: "app/ui",
    code: `${REPORT}
const { makeKernel, syncPlugins } = await import("@kb/plugin");
const { BUNDLED_DECLARATIONS } = await import("@kb/bundled");
const { extensionRow } = await import("@kb/contracts");
const { BROWSER_EXTENSIONS, CORE_UI_PLUGINS, familiesToLoad } = await import(process.cwd() + "/src/ui-plugins.ts");
const kernel = makeKernel({ host: "page" });
const entries = new Map(await Promise.all(Object.entries(BROWSER_EXTENSIONS)
  .filter(([, entry]) => entry !== null)
  .map(async ([name, entry]) => [name, await entry.load()])));
const optional = BUNDLED_DECLARATIONS.filter(({ name, required }) => required === undefined && entries.has(name)).map(({ name }) => name);
const enabled = new Set(entries.keys());
await runMatrix(optional, async () => {
  const rows = BUNDLED_DECLARATIONS.map((declaration) =>
    extensionRow(declaration, "bundled", enabled.has(declaration.name)));
  await Effect.runPromise(syncPlugins(kernel, [...CORE_UI_PLUGINS, ...familiesToLoad(rows).map((name) => entries.get(name))]));
  return kernel;
}, (name, on) => on ? enabled.add(name) : enabled.delete(name));
await Effect.runPromise(kernel.shutdown);
`,
  },
};

/** Run the probe for `name` and read the kernel it composed. */
function probeResult(name: CompositionName, matrix: boolean): unknown {
  const probe = PROBES[name];
  const run = Bun.spawnSync([process.execPath, "-e", probe.code], {
    cwd: join(PACKAGES_ROOT, probe.cwd),
    stdout: "pipe",
    stderr: "pipe",
    timeout: matrix ? 110_000 : 45_000,
    env: { ...process.env, KB_COMPOSITION_MATRIX: matrix ? "1" : "0" },
  });
  const out = run.stdout.toString().trim().split("\n").at(-1) ?? "";
  if (run.exitCode !== 0 || !out.startsWith("{")) {
    throw new Error(`the ${name} probe failed (${run.exitCode}): ${run.stderr.toString()}`);
  }
  return JSON.parse(out);
}

export function composition(name: CompositionName): Composition {
  return probeResult(name, false) as Composition;
}

export function switchMatrix(name: CompositionName): SwitchMatrix {
  return probeResult(name, true) as SwitchMatrix;
}
