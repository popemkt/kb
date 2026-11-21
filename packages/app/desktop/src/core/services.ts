/**
 * The desktop's services: what the core needs from outside it, each a
 * `Context.Service` the composition root provides (`shell/electrobun/index.ts`
 * in the app, stand-ins in the tests). The core's own services, the store
 * directory and the app, are layers over these (`stores.ts`, `app.ts`).
 */
import { Context, Layer } from "effect";
import { platformKeychain, type Keychain } from "@kb/keychain";
import { pairWithHost, submitCapture, type PairWithHost, type SubmitCapture } from "./capture.ts";
import type { DesktopConfig } from "./config.ts";
import type { FocusReturn } from "./focus.ts";
import type { KbRunner } from "./kb-command.ts";
import type { Shell } from "./shell.ts";

/** The native shell the app draws in. */
export class DesktopShell extends Context.Service<DesktopShell, Shell>()(
  "@kb/desktop/DesktopShell",
) {}

/** The desktop's settings and window state on this device. */
export class DeviceSettings extends Context.Service<DeviceSettings, DesktopConfig>()(
  "@kb/desktop/DeviceSettings",
) {}

/** The kb the desktop runs one-shot commands with. */
export class KbCli extends Context.Service<KbCli, KbRunner>()("@kb/desktop/KbCli") {}

/** Giving the keyboard back to the app quick capture took it from. */
export class FocusKeeper extends Context.Service<FocusKeeper, FocusReturn>()(
  "@kb/desktop/FocusKeeper",
) {}

/** How the desktop reaches a host on the capture wire: pairing, and submitting a capture. */
export class CaptureClient extends Context.Service<
  CaptureClient,
  { readonly pair: PairWithHost; readonly submit: SubmitCapture }
>()("@kb/desktop/CaptureClient") {
  /** The real `capture.pair` and `capture.submit` calls over HTTP. */
  static readonly layer = Layer.succeed(CaptureClient, {
    pair: pairWithHost,
    submit: submitCapture,
  });
}

/** Where a paired remote store's credential is kept: the platform keychain. */
export class CredentialKeychain extends Context.Service<CredentialKeychain, Keychain>()(
  "@kb/desktop/CredentialKeychain",
) {
  /** This machine's keychain (the macOS Keychain, or the freedesktop secret service). */
  static readonly layer = Layer.sync(CredentialKeychain, () => platformKeychain());
}
