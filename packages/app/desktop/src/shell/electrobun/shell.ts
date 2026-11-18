/**
 * The Electrobun shell: the shell port (`../core/shell.ts`) over Electrobun's
 * Bun main-process API, drawn in the system webview (WKWebView on macOS,
 * WebKitGTK on Linux). Nothing here decides anything; swapping the shell
 * means writing this file again for another one.
 */
import Electrobun, {
  ApplicationMenu,
  BrowserWindow,
  GlobalShortcut,
  Screen,
  Tray,
  Utils,
} from "electrobun/bun";
import { Effect, Option, Schema } from "effect";
import type { ApplicationMenuItemConfig, MenuItemConfig } from "electrobun/bun";
import type { MenuEntry, Shell, ShellWindow, WindowFrame, WindowSpec } from "../../core/shell.ts";

/** What the Electrobun events this adapter hears carry in `data`. */
const EventSchema = Schema.Struct({
  data: Schema.Struct({
    detail: Schema.optionalKey(Schema.String),
    action: Schema.optionalKey(Schema.String),
    url: Schema.optionalKey(Schema.String),
  }),
});
const decodeEvent = Schema.decodeUnknownOption(EventSchema);

/** `event.data[key]` when the event carries it as a string. */
function dataField(event: unknown, key: "detail" | "action" | "url"): string | undefined {
  return Option.getOrUndefined(decodeEvent(event))?.data[key];
}

function shellWindow(spec: WindowSpec): ShellWindow {
  const window = new BrowserWindow({
    title: spec.title,
    url: spec.url,
    frame: { ...spec.frame },
    titleBarStyle: "default",
    // No bridge into the page: kb's page and the desktop's own pages need
    // none, and a remote store's page must not reach the main process.
    sandbox: true,
  });
  if (spec.floating) {
    window.setAlwaysOnTop(true);
    window.setVisibleOnAllWorkspaces(true);
  }
  const on = (name: string, listener: () => void) => window.on(name, () => listener());
  return {
    focus: () => {
      window.show();
      window.activate();
    },
    close: () => window.close(),
    navigate: (url) => window.webview.loadURL(url),
    frame: () => window.getFrame(),
    onClosed: (listener) => on("close", listener),
    onFocused: (listener) => on("focus", listener),
    onFrameChanged: (listener) => {
      const report = () => listener(window.getFrame());
      on("resize", report);
      on("move", report);
    },
    onNavigated: (listener) => {
      const report = (event: unknown) => {
        const detail = dataField(event, "detail");
        if (typeof detail === "string") listener(detail);
      };
      window.webview.on("did-navigate", report);
      window.webview.on("did-navigate-in-page", report);
    },
  };
}

/** The menu entries as Electrobun menu items, each item's action its index in `runs`. */
function menuItems(entries: readonly MenuEntry[], runs: (() => void)[]): MenuItemConfig[] {
  return entries.map((entry): MenuItemConfig => {
    if (entry.kind === "divider") return { type: "divider" };
    if (entry.kind === "submenu")
      return { label: entry.label, submenu: menuItems(entry.entries, runs) };
    runs.push(entry.run);
    return { label: entry.label, action: `kb-menu:${runs.length - 1}` };
  });
}

/** The roles every macOS app's menu bar carries; WKWebView's ⌘C, ⌘V and ⌘Z go through them. */
const STANDARD_MENUS: ApplicationMenuItemConfig[] = [
  {
    label: "kb",
    submenu: [
      { role: "hide" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "divider" },
      { role: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "divider" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "selectAll" },
    ],
  },
  {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { role: "close" },
      { role: "bringAllToFront" },
    ],
  },
];

export function electrobunShell(): Shell {
  let runs: (() => void)[] = [];
  let tray: Tray | null = null;
  const menuClicked = (event: unknown) => {
    const action = dataField(event, "action");
    if (typeof action !== "string" || !action.startsWith("kb-menu:")) return;
    runs[Number(action.slice("kb-menu:".length))]?.();
  };
  ApplicationMenu.on("application-menu-clicked", menuClicked);

  return {
    openWindow: shellWindow,
    registerHotkey: (accelerator, run) => GlobalShortcut.register(accelerator, run),
    setMenu(entries) {
      runs = [];
      const items = menuItems(entries, runs);
      ApplicationMenu.setApplicationMenu([
        ...STANDARD_MENUS.slice(0, 1),
        { label: "Stores", submenu: items },
        ...STANDARD_MENUS.slice(1),
      ]);
      if (tray === null) {
        tray = new Tray({ title: "kb" });
        tray.on("tray-clicked", menuClicked);
      }
      tray.setMenu(items);
    },
    onOpenUrl(listener) {
      Electrobun.events.on("open-url", (event) => {
        const url = dataField(event, "url");
        if (typeof url === "string") listener(url);
      });
      // A link the app was launched with arrives as an argument on Linux and Windows.
      for (const arg of process.argv) if (arg.startsWith("kb://")) listener(arg);
    },
    onReopen(listener) {
      Electrobun.events.on("reopen", () => listener());
    },
    onQuitRequested(settle) {
      let settled = false;
      const settleThenQuit = () =>
        void Effect.runPromise(settle).finally(() => {
          settled = true;
          Utils.quit();
        });
      Electrobun.events.on("before-quit", (event: { response?: { allow: boolean } }) => {
        if (settled) return;
        event.response = { allow: false };
        settleThenQuit();
      });
      // A terminal's Ctrl-C, or the session ending, is a quit too.
      process.once("SIGINT", settleThenQuit);
      process.once("SIGTERM", settleThenQuit);
    },
    alert(message) {
      void Utils.showMessageBox({ type: "warning", title: "kb", message, buttons: ["OK"] });
    },
    exit: () => Utils.quit(),
    workArea(): WindowFrame {
      const { workArea } = Screen.getPrimaryDisplay();
      return workArea.width > 0 ? workArea : { x: 0, y: 0, width: 1440, height: 900 };
    },
  };
}
