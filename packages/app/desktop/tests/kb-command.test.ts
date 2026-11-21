/**
 * Which kb the desktop runs, and the environment it runs in: the order of
 * the candidates for a dev and a release build, a candidate that cannot run
 * passed over with its reason, and a kb script that execs `bun` by name
 * finding the build's Bun when the app inherited a PATH without one (an
 * app opened from Finder). Every environment here is built from a bare
 * PATH, never this test run's, which has Bun on it.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Effect } from "effect";
import { WIRE_PROTOCOL } from "@kb/contracts";
import { KB_SOURCE_BIN } from "@kb/test-kit";
import {
  kbCandidates,
  kbChannel,
  kbEnvironment,
  kbProcessRunner,
  processProbe,
  programPath,
  resolveKb,
  type KbCandidate,
  type KbProbe,
} from "../src/core/kb-command.ts";

const BARE = "/usr/bin:/bin";
let scratch = "";
afterEach(() => {
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
  scratch = "";
});

function scratchDir(): string {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "kb-desktop-kb-")));
  return scratch;
}

/** An executable shell script at `file`. */
function script(file: string, body: string): string {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/**
 * A kb that, like the checkout's `bin/kb`, execs its runtime found by name.
 * The name is one no machine has, so a Bun installed where the program path
 * looks cannot make the test pass or fail.
 */
const RUNTIME = "kb-test-runtime";
const NEEDS_BUN = `exec ${RUNTIME} "$@"`;
/** What a kb of `protocol` answers `kb --version --json` with. */
function versionJson(protocol: number, version = "9.9.9"): string {
  return JSON.stringify({ version, protocol });
}
/** A kb script that answers `--version --json` as a kb of `protocol` does, and nothing else. */
function speaks(protocol: number, version?: string): string {
  return `echo '${versionJson(protocol, version)}'`;
}
/** A stand-in Bun that answers `--version` as a kb of this app's protocol, and any command with a receipt. */
const FAKE_BUN = `case "$1" in --version) ${speaks(WIRE_PROTOCOL)} ;; *) echo '{"status":"succeeded","output":{"rows":[]}}' ;; esac`;

describe("programPath", () => {
  test("adds the install places to a bare PATH, and the build's runtimes last", () => {
    const dirs = programPath({
      path: BARE,
      home: "/Users/a",
      user: "a",
      runtimes: ["/nix/store/x-bun/bin/bun"],
    }).split(delimiter);
    expect(dirs.slice(0, 2)).toEqual(["/usr/bin", "/bin"]);
    expect(dirs).toContain("/etc/profiles/per-user/a/bin");
    expect(dirs).toContain("/opt/homebrew/bin");
    expect(dirs).toContain("/Users/a/.bun/bin");
    expect(dirs.at(-1)).toBe("/nix/store/x-bun/bin");
  });

  test("keeps the inherited order and names a directory once", () => {
    const path = programPath({
      path: "/opt/homebrew/bin:/usr/bin",
      home: "/h",
      user: undefined,
      runtimes: ["/opt/homebrew/bin/bun"],
    });
    const dirs = path.split(delimiter);
    expect(dirs.slice(0, 2)).toEqual(["/opt/homebrew/bin", "/usr/bin"]);
    expect(dirs.filter((d) => d === "/opt/homebrew/bin")).toHaveLength(1);
    expect(path).not.toContain("per-user");
  });
});

describe("kbCandidates", () => {
  function places() {
    const dir = scratchDir();
    const checkout = script(join(dir, "checkout", "bin", "kb"), NEEDS_BUN);
    const installed = script(join(dir, "profile", "bin", "kb"), "echo 1");
    // The same kb reached twice on the path (a profile linked into another) is one candidate.
    mkdirSync(join(dir, "link"));
    Bun.spawnSync(["ln", "-s", installed, join(dir, "link", "kb")]);
    const path = [join(dir, "empty"), join(dir, "profile", "bin"), join(dir, "link")].join(
      delimiter,
    );
    return { dir, checkout, installed, path };
  }

  test("a release build runs the installed kb before the checkout's", () => {
    const { checkout, installed, path } = places();
    expect(kbCandidates({ checkout, path }, "release")).toEqual([
      { source: "path", file: installed },
      { source: "checkout", file: checkout },
    ]);
  });

  test("a dev build runs its checkout's kb first", () => {
    const { checkout, installed, path } = places();
    expect(kbCandidates({ checkout, path }, "dev")).toEqual([
      { source: "checkout", file: checkout },
      { source: "path", file: installed },
    ]);
  });

  test("a kb the person named comes first, even with no file there; an empty place is skipped", () => {
    const { dir, checkout, installed, path } = places();
    expect(
      kbCandidates(
        {
          setting: join(dir, "gone", "kb"),
          env: "",
          bundled: join(dir, "app", "kb", "bin", "kb"),
          checkout,
          path,
        },
        "release",
      ),
    ).toEqual([
      { source: "setting", file: join(dir, "gone", "kb") },
      { source: "path", file: installed },
      { source: "checkout", file: checkout },
    ]);
  });

  test("only a dev build is dev; stable, canary and an unread channel are releases", () => {
    expect(kbChannel("dev")).toBe("dev");
    expect(["stable", "canary", ""].map(kbChannel)).toEqual(["release", "release", "release"]);
  });
});

describe("resolveKb", () => {
  const a: KbCandidate = { source: "setting", file: "/a" };
  const b: KbCandidate = { source: "checkout", file: "/b" };
  const c: KbCandidate = { source: "path", file: "/c" };
  const probe: KbProbe = (kb) => Effect.succeed(kb === c ? null : `${kb.file} cannot run`);

  test("runs the first candidate that runs, and keeps why each one before it did not", async () => {
    expect(await Effect.runPromise(resolveKb([a, b, c], probe))).toEqual({
      kb: c,
      skipped: [
        { kb: a, why: "/a cannot run" },
        { kb: b, why: "/b cannot run" },
      ],
    });
  });

  test("no candidate that runs is no kb, with every reason", async () => {
    const choice = await Effect.runPromise(resolveKb([a, b], probe));
    expect(choice.kb).toBeNull();
    expect(choice.skipped.map((s) => s.kb)).toEqual([a, b]);
  });
});

describe("a kb that runs but does not speak this app's wire protocol", () => {
  const env = kbEnvironment({ path: BARE, home: "/nonexistent", user: undefined });
  async function probe(body: string): Promise<string | null> {
    const kb: KbCandidate = { source: "path", file: script(join(scratchDir(), "kb"), body) };
    return Effect.runPromise(processProbe(env)(kb));
  }

  test("a kb older than `kb --version --json` is passed over, and the protocol it needs named", async () => {
    // Before it reported its protocol, kb printed its version alone, whatever followed the flag.
    const why = await probe("echo 0.3.1-nightly.20261101000000");
    expect(why).toContain("0.3.1-nightly.20261101000000");
    expect(why).toContain(`wire protocol ${WIRE_PROTOCOL}`);
    expect(why).toContain("update kb");
  });

  test("an older protocol asks for a newer kb", async () => {
    const why = await probe(speaks(WIRE_PROTOCOL - 1, "0.3.2"));
    expect(why).toBe(
      `kb 0.3.2 speaks wire protocol ${WIRE_PROTOCOL - 1}, and this app speaks ${WIRE_PROTOCOL}: update kb`,
    );
  });

  test("a newer protocol asks for a newer app", async () => {
    const why = await probe(speaks(WIRE_PROTOCOL + 1, "0.4.0"));
    expect(why).toBe(
      `kb 0.4.0 speaks wire protocol ${WIRE_PROTOCOL + 1}, and this app speaks ${WIRE_PROTOCOL}: update kb desktop`,
    );
  });

  test("this checkout's kb speaks the protocol this app was built with", async () => {
    // The checkout's kb execs Bun by name: the one this test runs on.
    const withBun = kbEnvironment({
      path: process.env.PATH,
      home: "/nonexistent",
      user: undefined,
    });
    const kb: KbCandidate = { source: "checkout", file: KB_SOURCE_BIN };
    expect(await Effect.runPromise(processProbe(withBun, 30_000)(kb))).toBeNull();
  });
});

describe("a kb that execs bun, from an app with a bare PATH", () => {
  test("without the build's Bun it cannot run, and says why", async () => {
    const dir = scratchDir();
    const kb: KbCandidate = { source: "checkout", file: script(join(dir, "kb"), NEEDS_BUN) };
    const env = kbEnvironment({ path: BARE, home: join(dir, "home"), user: undefined });
    const why = await Effect.runPromise(processProbe(env)(kb));
    expect(why).toContain("exited 127");
    expect(why).toContain(RUNTIME);
  });

  test("with the build's Bun on its program path it runs", async () => {
    const dir = scratchDir();
    const bun = script(join(dir, "store", "bun-1.4", "bin", RUNTIME), FAKE_BUN);
    const kb: KbCandidate = { source: "checkout", file: script(join(dir, "kb"), NEEDS_BUN) };
    const env = kbEnvironment({
      path: BARE,
      home: join(dir, "home"),
      user: undefined,
      runtimes: [bun],
    });
    expect(await Effect.runPromise(processProbe(env)(kb))).toBeNull();
    const runner = kbProcessRunner({ kb, skipped: [] }, { env, settingsFile: "/s.json" });
    expect(await Effect.runPromise(runner.run(dir, ["locations"]))).toEqual({
      status: "succeeded",
      output: { rows: [] },
    });
  });

  test("a release build that finds the checkout's kb broken runs the installed one", async () => {
    const dir = scratchDir();
    const checkout = script(join(dir, "checkout", "bin", "kb"), NEEDS_BUN);
    const installed = script(join(dir, "profile", "bin", "kb"), speaks(WIRE_PROTOCOL));
    const env = kbEnvironment({ path: BARE, home: join(dir, "home"), user: undefined });
    const places = { checkout, path: `${join(dir, "profile", "bin")}${delimiter}${env.PATH}` };
    const release = await Effect.runPromise(
      resolveKb(kbCandidates(places, "release"), processProbe(env)),
    );
    expect(release).toEqual({ kb: { source: "path", file: installed }, skipped: [] });
    // A dev build tries its checkout first, passes over it, and says why.
    const dev = await Effect.runPromise(resolveKb(kbCandidates(places, "dev"), processProbe(env)));
    expect(dev.kb).toEqual({ source: "path", file: installed });
    expect(dev.skipped.map((s) => s.kb)).toEqual([{ source: "checkout", file: checkout }]);
    expect(dev.skipped[0]?.why).toContain("exited 127");
  });

  test("a kb that fails without a receipt names itself and the setting that fixes it", async () => {
    const dir = scratchDir();
    const kb: KbCandidate = { source: "checkout", file: script(join(dir, "kb"), NEEDS_BUN) };
    const env = kbEnvironment({ path: BARE, home: join(dir, "home"), user: undefined });
    const runner = kbProcessRunner(
      { kb, skipped: [] },
      { env, settingsFile: "/Users/a/kb-desktop/settings.json" },
    );
    const receipt = await Effect.runPromise(runner.run(dir, ["locations"]));
    expect(receipt.status).toBe("failed");
    const message = receipt.status === "failed" ? receipt.message : "";
    expect(message).toStartWith("kb exited 127:");
    expect(message).toContain(`It ran ${kb.file} (the checkout the app was built from).`);
    expect(message).toContain('Set "kb" in /Users/a/kb-desktop/settings.json');
  });
});
