/**
 * The Electrobun build of kb desktop. `bun run build:app` builds for this
 * machine's OS and architecture (Electrobun does not cross-build);
 * `bun run build:mac` on a Mac also bundles a kb release into the app when
 * `bin/release-bundle` has made one (`out/kb-<version>`).
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ElectrobunConfig } from "electrobun/bun";

const repo = resolve(import.meta.dir, "../../..");
const version: string = (await Bun.file(join(repo, "package.json")).json()).version;
const release = join(repo, "out", `kb-${version}`);

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
      // The checkout this app was built from, whose kb is one of the
      // candidates (src/core/kb-command.ts → kbCandidates), and the Bun the
      // build ran with, which that kb execs by name: an app opened from
      // Finder may find no Bun of its own (a Nix dev shell's lives only in
      // the store), so its directory goes last on the kb's program path.
      // GAP [[01M7WV5DQDNMQMR9QYJN839TNJ]]: build-machine paths in the bundle.
      define: {
        KB_DESKTOP_CHECKOUT_KB: JSON.stringify(join(repo, "bin", "kb")),
        KB_DESKTOP_BUILD_BUN: JSON.stringify(Bun.which("bun") ?? ""),
      },
    },
    copy: existsSync(release) ? { [release]: "kb" } : {},
    mac: { codesign: false, notarize: false, createDmg: false },
  },
  runtime: { exitOnLastWindowClosed: false },
} satisfies ElectrobunConfig;
