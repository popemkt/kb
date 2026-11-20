/**
 * What the desktop keeps of its own, on this device, in its own directory:
 * the person's settings (which kb to run, the hotkey, the remote stores) and
 * its screen state (where each store's window was, and which were open).
 *
 * Local stores are not kept here: they are the home store's locations
 * (DESIGN.md → Locations), read through kb each time. A remote store is an
 * origin, which no location can name yet, so the desktop keeps those
 * (GAP [[01M7QTTRFKDF9B7F4M29Z84XJQ]]).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { WindowFrame } from "./shell.ts";

/**
 * A store served by a host elsewhere (a tailnet `kb ui`), by its origin,
 * paired once (`capture.pair`). Its credential is in the keychain under its
 * key (`stores.ts` → `credentialItem`), never here.
 */
export interface RemoteStore {
  /** Stable: what a deep link, the window state and the keychain item name it by. */
  readonly key: string;
  readonly name: string;
  /** The bare `https:` (or loopback `http:`) origin its page is served at. */
  readonly origin: string;
  /** This device's id at the host, from the pairing. */
  readonly deviceId: string;
  /** The capture contract versions its host said it accepts when it was paired. */
  readonly accepts: readonly number[];
}

export interface DesktopSettings {
  /** The kb command to run, when it is not found on its own (`kb-command.ts`). */
  readonly kb?: string;
  /** The quick-capture hotkey, as an accelerator (`CommandOrControl+Shift+K`). */
  readonly hotkey: string;
  /** The key of the store quick capture sends to; else the last focused store's. */
  readonly captureStore?: string;
  /** Stop, on quit, the `kb ui` hosts this app started. */
  readonly stopStartedHostsOnQuit: boolean;
  readonly remotes: readonly RemoteStore[];
}

/** Where one store's window was, and where its page stood. */
export interface WindowMemory {
  readonly frame: WindowFrame;
  /** Whether it was open when the app last quit; those reopen at launch. */
  readonly open: boolean;
  /** The page's path (`/node/<id>`), so a host on a new port reopens where it was. */
  readonly path?: string;
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  hotkey: "CommandOrControl+Shift+K",
  stopStartedHostsOnQuit: true,
  remotes: [],
};

/**
 * The desktop's directory: `KB_DESKTOP_HOME`, else beside kb's own data on
 * macOS, else under the XDG config home.
 */
export function desktopDir(
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
  home: string,
): string {
  const set = env.KB_DESKTOP_HOME;
  if (set !== undefined && set !== "") return resolve(set);
  if (platform === "darwin") return join(home, "Library", "Application Support", "kb-desktop");
  const config = env.XDG_CONFIG_HOME;
  return join(config !== undefined && config !== "" ? config : join(home, ".config"), "kb-desktop");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Write `value` whole, through a temporary file, so a crash never leaves half a file. */
function writeJson(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/** A paired remote as settings keep it; one that is not (an old pasted-token entry, say) is left out. */
function remoteOf(value: unknown): RemoteStore | null {
  if (!isRecord(value)) return null;
  const { key, name, origin, deviceId, accepts } = value;
  if (
    typeof key !== "string" ||
    typeof name !== "string" ||
    typeof origin !== "string" ||
    typeof deviceId !== "string" ||
    !Array.isArray(accepts)
  )
    return null;
  const versions = accepts.filter((v): v is number => typeof v === "number");
  return { key, name, origin, deviceId, accepts: versions };
}

/** Settings as read from `raw`, each missing or malformed member at its default. */
export function settingsOf(raw: unknown): DesktopSettings {
  if (!isRecord(raw)) return DEFAULT_SETTINGS;
  const remotes = Array.isArray(raw.remotes)
    ? raw.remotes.flatMap((r) => {
        const remote = remoteOf(r);
        return remote === null ? [] : [remote];
      })
    : [];
  return {
    ...(typeof raw.kb === "string" && raw.kb !== "" ? { kb: raw.kb } : {}),
    hotkey:
      typeof raw.hotkey === "string" && raw.hotkey !== "" ? raw.hotkey : DEFAULT_SETTINGS.hotkey,
    ...(typeof raw.captureStore === "string" ? { captureStore: raw.captureStore } : {}),
    stopStartedHostsOnQuit:
      typeof raw.stopStartedHostsOnQuit === "boolean"
        ? raw.stopStartedHostsOnQuit
        : DEFAULT_SETTINGS.stopStartedHostsOnQuit,
    remotes,
  };
}

function frameOf(value: unknown): WindowFrame | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (typeof width !== "number" || typeof height !== "number" || width < 200 || height < 150)
    return null;
  return { x, y, width, height };
}

function windowsOf(raw: unknown): Map<string, WindowMemory> {
  const windows = new Map<string, WindowMemory>();
  if (!isRecord(raw)) return windows;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const frame = frameOf(value.frame);
    if (frame === null) continue;
    const path =
      typeof value.path === "string" && value.path.startsWith("/") ? value.path : undefined;
    windows.set(key, { frame, open: value.open === true, ...(path === undefined ? {} : { path }) });
  }
  return windows;
}

/** The desktop's settings and window state, read once and written as they change. */
export class DesktopConfig {
  readonly dir: string;
  #settings: DesktopSettings;
  readonly #windows: Map<string, WindowMemory>;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.#settings = settingsOf(readJson(this.settingsFile));
    this.#windows = windowsOf(readJson(this.#windowsFile));
  }

  /** The person's settings file, which messages name when a setting is the fix. */
  get settingsFile(): string {
    return join(this.dir, "settings.json");
  }

  get #windowsFile(): string {
    return join(this.dir, "windows.json");
  }

  get settings(): DesktopSettings {
    return this.#settings;
  }

  updateSettings(change: (settings: DesktopSettings) => DesktopSettings): DesktopSettings {
    this.#settings = change(this.#settings);
    writeJson(this.settingsFile, this.#settings);
    return this.#settings;
  }

  window(key: string): WindowMemory | undefined {
    return this.#windows.get(key);
  }

  /** The stores whose windows were open when the app last quit. */
  openWindows(): string[] {
    return [...this.#windows].flatMap(([key, memory]) => (memory.open ? [key] : []));
  }

  rememberWindow(key: string, change: Partial<WindowMemory> & { frame?: WindowFrame }): void {
    const was = this.#windows.get(key);
    const frame = change.frame ?? was?.frame;
    if (frame === undefined) return;
    this.#windows.set(key, { ...was, ...change, frame, open: change.open ?? was?.open ?? false });
    writeJson(this.#windowsFile, Object.fromEntries(this.#windows));
  }
}

/** The config at this process's desktop directory. */
export function currentConfig(): DesktopConfig {
  // oxlint-disable-next-line node/no-process-env -- the one read of where the desktop keeps its own state
  return new DesktopConfig(desktopDir(process.env, process.platform, homedir()));
}
