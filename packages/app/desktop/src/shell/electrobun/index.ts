/**
 * The desktop app's entry under Electrobun (`electrobun.config.ts` names
 * it): the core over the Electrobun shell. Everything shell-agnostic is in
 * `core/`; this file only picks the shell, the kb to run and the focus
 * return for this platform.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { Updater } from "electrobun/bun";
import { Effect, Layer } from "effect";
import { Desktop, DesktopLive } from "../../core/app.ts";
import { currentConfig } from "../../core/config.ts";
import { platformFocusReturn } from "../../core/focus.ts";
import {
  kbCandidates,
  kbChannel,
  kbEnvironment,
  kbProcessRunner,
  processProbe,
} from "../../core/kb-command.ts";
import {
  CaptureClient,
  CredentialKeychain,
  DeviceSettings,
  DesktopShell,
  FocusKeeper,
  KbCli,
} from "../../core/services.ts";
import { electrobunShell } from "./shell.ts";

/**
 * Build constants (`electrobun.config.ts` → `define`): the checkout's
 * `bin/kb`, and the Bun the build ran with ("" when it found none). They
 * are not environment variables, so nothing at run time can set or clear
 * them.
 */
declare const KB_DESKTOP_CHECKOUT_KB: string;
declare const KB_DESKTOP_BUILD_BUN: string;

/** The app's bundle id (`electrobun.config.ts`), so focus return skips kb itself. */
const BUNDLE_ID = "dev.kb.desktop";

const shell = electrobunShell();
const config = currentConfig();
// oxlint-disable-next-line node/no-process-env -- where an app run from a terminal is told which kb to use
const { KB_DESKTOP_KB, PATH, USER } = process.env;
const env = kbEnvironment({
  path: PATH,
  home: homedir(),
  user: USER,
  runtimes: KB_DESKTOP_BUILD_BUN === "" ? [] : [KB_DESKTOP_BUILD_BUN],
});
const places = {
  setting: config.settings.kb,
  env: KB_DESKTOP_KB,
  // A kb release copied into the app by `build:mac` (Resources/app/kb).
  bundled: join(import.meta.dir, "..", "kb", "bin", "kb"),
  checkout: KB_DESKTOP_CHECKOUT_KB,
  path: env.PATH ?? "",
};
const channel = kbChannel(await Updater.localInfo.channel());
const services = Layer.mergeAll(
  Layer.succeed(DesktopShell, shell),
  Layer.succeed(DeviceSettings, config),
  // The kb is resolved when a command first needs it, and again when the
  // candidates change or the kb in use stops answering (kbProcessRunner).
  Layer.effect(
    KbCli,
    kbProcessRunner({
      candidates: () => kbCandidates(places, channel),
      probe: processProbe(env),
      env,
      settingsFile: config.settingsFile,
    }),
  ),
  Layer.succeed(FocusKeeper, platformFocusReturn(process.platform, BUNDLE_ID)),
  CaptureClient.layer,
  CredentialKeychain.layer,
);
const main = Effect.gen(function* () {
  const desktop = yield* Desktop;
  yield* desktop.start;
});
Effect.runFork(main.pipe(Effect.provide(DesktopLive.pipe(Layer.provide(services)))));
