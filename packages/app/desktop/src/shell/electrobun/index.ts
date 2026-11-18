/**
 * The desktop app's entry under Electrobun (`electrobun.config.ts` names
 * it): the core over the Electrobun shell. Everything shell-agnostic is in
 * `core/`; this file only picks the shell, the kb to run and the focus
 * return for this platform.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { Effect, Layer } from "effect";
import { Desktop, DesktopLive } from "../../core/app.ts";
import { currentConfig } from "../../core/config.ts";
import { platformFocusReturn } from "../../core/focus.ts";
import { kbProcessRunner, programPath, resolveKb } from "../../core/kb-command.ts";
import {
  CaptureClient,
  DeviceSettings,
  DesktopShell,
  FocusKeeper,
  KbCli,
} from "../../core/services.ts";
import { electrobunShell } from "./shell.ts";

/**
 * The checkout's `bin/kb`, which the build writes in place of this name
 * (`electrobun.config.ts` → `define`). It is a build constant, not an
 * environment variable, so nothing at run time can set or clear it.
 */
declare const KB_DESKTOP_CHECKOUT_KB: string;

/** The app's bundle id (`electrobun.config.ts`), so focus return skips kb itself. */
const BUNDLE_ID = "dev.kb.desktop";

const shell = electrobunShell();
const config = currentConfig();
// oxlint-disable-next-line node/no-process-env -- where an app run from a terminal is told which kb to use
const { KB_DESKTOP_KB, PATH, USER } = process.env;
const kb = resolveKb({
  setting: config.settings.kb,
  env: KB_DESKTOP_KB,
  // A kb release copied into the app by `build:mac` (Resources/app/kb).
  bundled: join(import.meta.dir, "..", "kb", "bin", "kb"),
  // The checkout the app was built from, stamped in at build time.
  checkout: KB_DESKTOP_CHECKOUT_KB,
  path: programPath(PATH, homedir(), USER),
});

if (kb === null) {
  shell.alert(
    `kb desktop cannot find kb. Install kb, or set "kb" to its path in ${join(config.dir, "settings.json")}.`,
  );
  shell.exit();
} else {
  const services = Layer.mergeAll(
    Layer.succeed(DesktopShell, shell),
    Layer.succeed(DeviceSettings, config),
    Layer.succeed(KbCli, kbProcessRunner(kb)),
    Layer.succeed(FocusKeeper, platformFocusReturn(process.platform, BUNDLE_ID)),
    CaptureClient.layer,
  );
  const main = Effect.gen(function* () {
    const desktop = yield* Desktop;
    yield* desktop.start;
  });
  Effect.runFork(main.pipe(Effect.provide(DesktopLive.pipe(Layer.provide(services)))));
}
