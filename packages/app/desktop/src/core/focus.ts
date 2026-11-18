/**
 * Giving focus back. Quick capture takes the keyboard from whatever app the
 * person was in; closing it must hand the keyboard back to that app, not
 * leave kb in front with no window. On macOS the app in front is read with
 * `lsappinfo` before the panel shows and reactivated with `open -b` after,
 * neither of which asks for a permission. Elsewhere the window manager
 * already does this when the panel closes.
 */
import { Effect } from "effect";

/** Remembers the app in front and brings it back. */
export interface FocusReturn {
  /** Note the app in front now (before the panel takes focus). */
  readonly remember: Effect.Effect<void>;
  /** Bring that app back to the front. */
  readonly restore: Effect.Effect<void>;
}

/** What `cmd` prints, or nothing when it cannot run. */
const output = Effect.fn("kb.desktop.focus.output")(
  function* (cmd: readonly string[]) {
    const child = yield* Effect.try(() =>
      Bun.spawn([...cmd], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 2000 }),
    );
    const [text] = yield* Effect.promise(() =>
      Promise.all([new Response(child.stdout).text(), child.exited]),
    );
    return text;
  },
  Effect.orElseSucceed(() => ""),
);

/** The bundle id in `lsappinfo info -only bundleid` output (`"CFBundleIdentifier"="com.apple.Safari"`). */
export function bundleIdOf(info: string): string | null {
  const match = /"CFBundleIdentifier"="([^"]+)"/.exec(info);
  return match?.[1] ?? null;
}

/** macOS: by bundle id, skipping `own` (kb itself was in front: nothing to give back). */
function macFocusReturn(own: string): FocusReturn {
  let previous: string | null = null;
  return {
    remember: Effect.gen(function* () {
      const front = (yield* output(["lsappinfo", "front"])).trim();
      const id =
        front === ""
          ? null
          : bundleIdOf(yield* output(["lsappinfo", "info", "-only", "bundleid", front]));
      previous = id === own ? null : id;
    }),
    restore: Effect.gen(function* () {
      const id = previous;
      previous = null;
      if (id !== null) yield* output(["open", "-b", id]);
    }),
  };
}

export const NO_FOCUS_RETURN: FocusReturn = { remember: Effect.void, restore: Effect.void };

export function platformFocusReturn(platform: string, own: string): FocusReturn {
  return platform === "darwin" ? macFocusReturn(own) : NO_FOCUS_RETURN;
}
