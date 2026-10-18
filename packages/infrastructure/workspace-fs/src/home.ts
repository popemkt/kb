/**
 * Where the person's home store lives (DESIGN.md → Locations): `KB_HOME`
 * when it is set, else the platform's place for an application's own data,
 * outside every store. It is state produced by use, so it goes to regular
 * backup, never to git. A test run (`NODE_ENV=test`) has no default: it
 * names its own home, or resolving one is a defect.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Effect, Schema } from "effect";

/**
 * A test run that named no home store of its own. Never caught: the fix is
 * the test's, which must name one (`KB_HOME`) for itself and its children.
 */
export class TestRunHomeUnnamed extends Schema.TaggedError<TestRunHomeUnnamed>()(
  "Kb/TestRunHomeUnnamed",
  { message: Schema.String },
) {}

/**
 * The home store's directory, for an environment on a platform.
 *
 * @throws TestRunHomeUnnamed when `env` is a test run's and names no home.
 */
export function homePath(
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
  home: string,
): string {
  const set = env.KB_HOME;
  if (set !== undefined && set !== "") return resolve(set);
  if (env.NODE_ENV === "test") {
    throw new TestRunHomeUnnamed({
      message:
        "a test run (NODE_ENV=test) must name its home store in KB_HOME; it never falls back to the person's",
    });
  }
  if (platform === "darwin") return join(home, "Library", "Application Support", "kb", "home");
  const data = env.XDG_DATA_HOME;
  return join(
    data !== undefined && data !== "" ? data : join(home, ".local", "share"),
    "kb",
    "home",
  );
}

/**
 * The home store's directory now. The environment is read each time this
 * runs, not once per process, so a process that names another home (a test,
 * say) is answered with it.
 */
export const currentHome: Effect.Effect<string> = Effect.sync(() =>
  // oxlint-disable-next-line node/no-process-env -- kb's one read of where the person's home store lives
  homePath(process.env, process.platform, homedir()),
);
