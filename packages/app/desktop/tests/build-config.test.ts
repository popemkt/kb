/**
 * What a build of the app carries from the machine that built it
 * (`electrobun.config.ts`). The config is loaded as Electrobun loads it, by
 * a Bun child whose argv holds the build's `--env`, from a copy placed in a
 * scratch checkout, so the paths it could stamp are the scratch's own and
 * a stable build's kb release can be put there or left out.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONFIG = join(import.meta.dir, "..", "electrobun.config.ts");
const VERSION = "9.9.9";

let scratch = "";
afterEach(() => {
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
  scratch = "";
});

/** A scratch checkout holding the config, and a kb release when `release` is set. */
function checkout(release: boolean): string {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "kb-desktop-build-")));
  const desktop = join(scratch, "packages", "app", "desktop");
  mkdirSync(desktop, { recursive: true });
  copyFileSync(CONFIG, join(desktop, "electrobun.config.ts"));
  writeFileSync(join(scratch, "package.json"), JSON.stringify({ version: VERSION }));
  if (release) mkdirSync(join(scratch, "out", `kb-${VERSION}`, "bin"), { recursive: true });
  return desktop;
}

/** The config a build with `args` reads, or why it refused. */
function load(desktop: string, args: readonly string[]): { config?: unknown; error?: string } {
  const loader = join(desktop, "load.ts");
  writeFileSync(
    loader,
    `console.log(JSON.stringify((await import("./electrobun.config.ts")).default));\n`,
  );
  const child = Bun.spawnSync([process.execPath, loader, ...args], { cwd: desktop });
  return child.exitCode === 0
    ? { config: JSON.parse(child.stdout.toString()) }
    : { error: child.stderr.toString() };
}

interface Build {
  build: {
    bun: { define: Record<string, string> };
    bunVersion: string;
    copy: Record<string, string>;
  };
}

describe("electrobun.config.ts", () => {
  test("a stable build carries its kb release and no path of the machine it was built on", () => {
    const desktop = checkout(true);
    const { config } = load(desktop, ["--env=stable"]);
    const { build } = config as Build;
    expect(build.copy).toEqual({ [join(scratch, "out", `kb-${VERSION}`)]: "kb" });
    expect(JSON.stringify(build.bun.define)).not.toContain(scratch);
    expect(JSON.stringify(build.bun.define)).not.toContain(process.execPath);
    expect(build.bunVersion).toBe(Bun.version);
  });

  test("a stable build without a kb release refuses, and says how to make one", () => {
    const desktop = checkout(false);
    expect(load(desktop, ["--env=canary"]).error).toContain("bin/release-bundle");
  });

  test("a dev build runs beside its checkout, whose kb it records", () => {
    const desktop = checkout(false);
    const { build } = load(desktop, []).config as Build;
    expect(build.bun.define).toEqual({
      KB_DESKTOP_CHECKOUT_KB: JSON.stringify(join(scratch, "bin", "kb")),
    });
    expect(build.copy).toEqual({});
    expect(build.bunVersion).toBe(Bun.version);
  });
});
