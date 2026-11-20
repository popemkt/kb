/**
 * kb desktop's shell-agnostic core, for another shell's adapter and for the
 * tests. The Electrobun entry is `shell/electrobun/index.ts`, which Electrobun builds; nothing
 * imports it.
 */
export { Desktop, DesktopLive, pagePath, placeWindow } from "./core/app.ts";
export type { DesktopApp } from "./core/app.ts";
export {
  CAPTURE_CONTRACT,
  captureOutcome,
  localIsoTime,
  submitCapture,
  textCapture,
} from "./core/capture.ts";
export type {
  CaptureHost,
  CaptureOutcome,
  CaptureSubmit,
  PairWithHost,
  SubmitCapture,
} from "./core/capture.ts";
export { DEFAULT_SETTINGS, DesktopConfig, desktopDir, settingsOf } from "./core/config.ts";
export type { DesktopSettings, RemoteStore, WindowMemory } from "./core/config.ts";
export { startControlServer } from "./core/control.ts";
export type { ControlActions, ControlServer } from "./core/control.ts";
export { nodePagePath, parseDeepLink } from "./core/deep-link.ts";
export type { DeepLink } from "./core/deep-link.ts";
export { bundleIdOf, NO_FOCUS_RETURN, platformFocusReturn } from "./core/focus.ts";
export type { FocusReturn } from "./core/focus.ts";
export {
  kbCandidates,
  kbEnvironment,
  kbProcessRunner,
  processProbe,
  resolveKb,
} from "./core/kb-command.ts";
export type { KbCandidate, KbRunner, Receipt } from "./core/kb-command.ts";
export {
  CaptureClient,
  CredentialKeychain,
  DesktopShell,
  DeviceSettings,
  FocusKeeper,
  KbCli,
} from "./core/services.ts";
export type { MenuEntry, Shell, ShellWindow, WindowFrame, WindowSpec } from "./core/shell.ts";
export {
  findStore,
  locationStores,
  remoteOrigin,
  StoreDirectory,
  StoreError,
} from "./core/stores.ts";
export type { LocalStatus, Store, Stores } from "./core/stores.ts";
