/**
 * The Electrobun build of kb desktop, for this machine's OS and
 * architecture (Electrobun does not cross-build). `bun run build:app` is a
 * dev build, run beside the checkout it was built from; `bun run build:mac`
 * makes a kb release (`bin/release-bundle`) and builds a stable app that
 * carries it. Only a dev build carries a path of the machine that built it.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ElectrobunConfig } from "electrobun/bun";

const repo = resolve(import.meta.dir, "../../..");
const version: string = (await Bun.file(join(repo, "package.json")).json()).version;
const release = join(repo, "out", `kb-${version}`);

/** The build's channel, as Electrobun reads it: `--env=dev|canary|stable`, dev when absent. */
const channel = process.argv.find((arg) => arg.startsWith("--env="))?.slice("--env=".length);
const dev = channel !== "canary" && channel !== "stable";
if (!dev && !existsSync(release))
  throw new Error(
    `a ${channel} build carries a kb release, and ${release} is missing: run \`sh bin/release-bundle\` first (\`bun run build:mac\` does)`,
  );

export default {
  app: {
    name: "kb",
    identifier: "dev.kb.desktop",
    version,
    description: "kb, the repo-native graph datastore, as a desktop app",
    urlSchemes: ["kb"],
  },
  build: {
    bun: {
      entrypoint: "src/shell/electrobun/index.ts",
      // A dev build runs beside the checkout it was built from, whose kb is
      // one of the candidates (src/core/kb-command.ts → kbCandidates); any
      // other build runs the kb it carries or one installed.
      define: { KB_DESKTOP_CHECKOUT_KB: JSON.stringify(dev ? join(repo, "bin", "kb") : "") },
    },
    // The app runs on the Bun the build ran with, by version, and so do the
    // kbs it runs: a kb execs Bun by name, and an app opened from Finder may
    // find none installed, so its own (`process.execPath`) is on their path.
    bunVersion: Bun.version,
    copy: dev ? {} : { [release]: "kb" },
    mac: { codesign: false, notarize: false, createDmg: false },
  },
  runtime: { exitOnLastWindowClosed: false },
} satisfies ElectrobunConfig;
