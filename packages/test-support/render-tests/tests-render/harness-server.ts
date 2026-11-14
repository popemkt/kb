import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * The UI every harness instance serves: a Vite `test-render` build, the only
 * mode in which the renderers expose their internals (`__kbSigma`,
 * `__kbForce3d`) to a spec. It is the harness's own output, never
 * `ui/dist`, so a spec cannot pass or fail on whichever production build — or
 * no build at all — happens to be lying there.
 */
const HARNESS_UI_DIST = resolve(import.meta.dirname, "../dist");

/** Build {@link HARNESS_UI_DIST} from the current UI source. Run once per suite. */
export function buildHarnessUi(): void {
  const build = spawnSync(
    "bun",
    [
      "run",
      "--filter",
      "@kb/ui",
      "build:app",
      "--mode",
      "test-render",
      "--outDir",
      HARNESS_UI_DIST,
      "--emptyOutDir",
    ],
    { cwd: process.cwd(), stdio: ["ignore", "ignore", "inherit"] },
  );
  if (build.status !== 0) {
    throw new Error(`render harness UI build failed (exit ${build.status ?? build.signal})`);
  }
}

async function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  if (!server.killed) server.kill("SIGTERM");
  await once(server, "exit");
}

/** A port nothing is bound to right now, as the OS hands it out. */
async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  await once(probe, "close");
  if (address === null || typeof address === "string") throw new Error("no free port");
  return address.port;
}

/** The argument that asks `tests-render/server/server.ts` to install the example extension. */
export const EXAMPLE_ARG = "--example";
/** The argument that asks `tests-render/server/server.ts` to serve the store with `kb ui`. */
export const HOSTED_ARG = "--hosted";

export interface HarnessOptions {
  /**
   * Install the test kit's example repository extension (`@kb/test-kit`'s
   * `EXAMPLE_EXTENSION`) in the scratch root, trusted as its owner would
   * trust it, so a spec drives what a trusted repository extension adds.
   */
  readonly example?: boolean;
  /**
   * Serve the scratch store with `kb ui` itself, the process a person runs,
   * rather than `startUi` alone, so the families only `kb ui` hosts (the
   * agent, routines: DESIGN.md → Plugin channels) are there to switch on.
   */
  readonly hosted?: boolean;
}

/** A running harness: where it serves, and how to stop it and remove its scratch root. */
export interface Harness {
  readonly url: string;
  readonly stop: () => Promise<void>;
}

/**
 * Spawn a harness UI over a fresh fixture store (`tests-render/server/server.ts`).
 *
 * Every test gets its own instance, through the `harness` fixture in
 * `harness-test.ts`. The store lives on the server for that server's
 * lifetime, so a test that switches a renderer or promotes a node would
 * otherwise change what a later test counts — which is exactly how a passing
 * test makes an unrelated one fail. A process per store, and not a reset
 * inside one: the server reads its home, data and cache from the process's
 * environment whenever it needs them, so two stores in one process would
 * share a home store and its trust. What the process costs to start,
 * {@link HarnessPool} spends while the previous test runs.
 */
async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const port = await freePort();
  // The port travels as an argument. The served UI travels through the
  // server's own override, `KB_UI_DIST` (packages/app/server/src/paths.ts):
  // this process runs under Node, so it cannot import that Bun module to
  // name it, and the harness is the override's reason to exist. The server
  // is a test run (`NODE_ENV=test`), so it never falls back to the person's
  // home, data or cache (@kb/workspace-fs's `home.ts`): it names its home
  // and data in its scratch root, and keeps no build archive, where it would
  // otherwise publish its test build among the person's kept builds and
  // prune theirs.
  const args = [
    String(port),
    ...(options.example === true ? [EXAMPLE_ARG] : []),
    ...(options.hosted === true ? [HOSTED_ARG] : []),
  ];
  const server = spawn("bun", ["tests-render/server/server.ts", ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, KB_UI_DIST: HARNESS_UI_DIST, NODE_ENV: "test" },
  });
  const url = `http://127.0.0.1:${port}`;
  server.stdout.setEncoding("utf8");
  server.stdout.on("data", (chunk: string) => process.stdout.write(chunk));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/graph`);
      if (response.ok) return { url, stop: () => stop(server) };
    } catch {
      // The process needs a moment to load the data root and bind its port.
    }
    await delay(100);
  }
  await stop(server);
  throw new Error(`render harness UI did not start at ${url}`);
}

/**
 * One Playwright worker's harnesses, each started one test ahead.
 *
 * A test still gets a harness no test has touched, with its own process,
 * scratch root, home store and port, and that harness is stopped when the
 * test ends. What the pool changes is when it starts: while a test runs,
 * the next test's harness boots beside it, so the next test takes one that
 * is already listening. The spare has the options of the test that took the
 * last one, which are the next test's within a file (`test.use` is per
 * file); a test that asks for other options stops the spare and starts its own.
 */
export class HarnessPool {
  #spare: { readonly key: string; readonly harness: Promise<Harness> } | null = null;
  /** Spares a test's other options displaced, stopping; {@link close} waits for them. */
  readonly #stopping = new Set<Promise<void>>();

  /** A fresh harness for one test, which the caller stops. */
  take(options: HarnessOptions): Promise<Harness> {
    const key = JSON.stringify(options);
    const spare = this.#spare;
    const next = startHarness(options);
    // Handled here, so a spare that fails to start while a test runs fails
    // the test that takes it, not the worker the moment it rejects.
    next.catch(() => {});
    this.#spare = { key, harness: next };
    if (spare?.key === key) return spare.harness;
    if (spare !== null) {
      const stopping = stopWhenStarted(spare.harness);
      this.#stopping.add(stopping);
      void stopping.finally(() => this.#stopping.delete(stopping));
    }
    return startHarness(options);
  }

  /** Stop the spare no test took, and wait out any still stopping. */
  async close(): Promise<void> {
    const spare = this.#spare;
    this.#spare = null;
    if (spare !== null) await stopWhenStarted(spare.harness);
    await Promise.all(this.#stopping);
  }
}

/** Stop a harness once it is up; one that never started has nothing to stop. */
async function stopWhenStarted(harness: Promise<Harness>): Promise<void> {
  await harness.then(
    (started) => started.stop(),
    () => undefined,
  );
}
