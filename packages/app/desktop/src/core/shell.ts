/**
 * The shell port: what the desktop core needs of a native shell, and nothing
 * else. The core owns every decision (which store, which URL, what a capture
 * sends, what quitting stops); a shell only draws windows, owns OS events and
 * exits. Electrobun implements it today (`../shell/electrobun/`); a Tauri
 * shell would implement the same members over its IPC, with this core in the
 * Bun sidecar.
 */
import type { Effect } from "effect";

/** A window's place on screen, in points. */
export interface WindowFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a window is opened with. */
export interface WindowSpec {
  readonly title: string;
  readonly url: string;
  readonly frame: WindowFrame;
  /** A small panel over every app (quick capture), rather than a workspace window. */
  readonly floating: boolean;
}

/** One open native window, as the core drives it. */
export interface ShellWindow {
  focus(): void;
  close(): void;
  /** Show `url` in the window, in place. */
  navigate(url: string): void;
  frame(): WindowFrame;
  /** The window was closed, by the person or by `close`. */
  onClosed(listener: () => void): void;
  onFocused(listener: () => void): void;
  onFrameChanged(listener: (frame: WindowFrame) => void): void;
  /** The page moved to `url` (a full navigation or one in the page). */
  onNavigated(listener: (url: string) => void): void;
}

/** A menu entry: the tray menu and the application menu are drawn from one list. */
export type MenuEntry =
  | { readonly kind: "item"; readonly label: string; readonly run: () => void }
  | { readonly kind: "submenu"; readonly label: string; readonly entries: readonly MenuEntry[] }
  | { readonly kind: "divider" };

export interface Shell {
  openWindow(spec: WindowSpec): ShellWindow;
  /** Register a system-wide hotkey; false when the OS or another app holds it. */
  registerHotkey(accelerator: string, run: () => void): boolean;
  /** Draw the tray menu and the application menu from `entries`. */
  setMenu(entries: readonly MenuEntry[]): void;
  /** A `kb://` link was opened (from the OS, or the launch arguments). */
  onOpenUrl(listener: (url: string) => void): void;
  /** The app was activated with no window to show (macOS dock click). */
  onReopen(listener: () => void): void;
  /**
   * The OS or the person asked to quit (⌘Q, the dock). The shell waits for
   * `settle` before it exits.
   */
  onQuitRequested(settle: Effect.Effect<void>): void;
  /** Tell the person something went wrong (a dialog). */
  alert(message: string): void;
  /** Exit now; the core has already settled. */
  exit(): void;
  /** The primary display's usable area, for placing a first window. */
  workArea(): WindowFrame;
}
