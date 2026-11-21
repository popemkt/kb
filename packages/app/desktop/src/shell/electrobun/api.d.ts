/**
 * The slice of Electrobun 1.18's main-process API (`electrobun/bun`) that
 * `shell.ts` and `electrobun.config.ts` use, declared by hand. Electrobun
 * ships that API as TypeScript source, which does not compile under kb's
 * strictness (it names `self` and leaves return paths implicit), so the
 * package tsconfig maps the module here (`paths`, sanctioned in
 * harness/src/constraints.ts) while Electrobun's own bundler builds the
 * real one. Keep it to what the adapter calls, as Electrobun declares it
 * (node_modules/electrobun/dist/api/bun).
 * GAP [[01M7QTTS5YXQGNPZ1XRTVNTK4A]]
 */
declare module "electrobun/bun" {
  export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export type MenuItemConfig =
    | { type: "divider" | "separator" }
    | {
        type?: "normal";
        label?: string;
        action?: string;
        role?: string;
        submenu?: MenuItemConfig[];
        enabled?: boolean;
      };
  export type ApplicationMenuItemConfig = MenuItemConfig;

  export class BrowserWindow {
    constructor(options: {
      title: string;
      url: string;
      frame: Rectangle;
      titleBarStyle?: "hidden" | "hiddenInset" | "default";
      sandbox?: boolean;
    });
    readonly id: number;
    readonly webview: {
      loadURL(url: string): void;
      on(name: string, handler: (event: unknown) => void): void;
    };
    show(): void;
    activate(): void;
    close(): void;
    setAlwaysOnTop(alwaysOnTop: boolean): void;
    setVisibleOnAllWorkspaces(visible: boolean): void;
    getFrame(): Rectangle;
    on(name: string, handler: (event: unknown) => void): void;
  }

  export class Tray {
    constructor(options?: { title?: string; image?: string; template?: boolean });
    setMenu(menu: MenuItemConfig[]): void;
    on(name: "tray-clicked", handler: (event: unknown) => void): void;
  }

  export const ApplicationMenu: {
    setApplicationMenu(menu: ApplicationMenuItemConfig[]): void;
    on(name: "application-menu-clicked", handler: (event: unknown) => void): void;
  };

  export const GlobalShortcut: {
    register(accelerator: string, callback: () => void): boolean;
  };

  export const Screen: {
    getPrimaryDisplay(): { bounds: Rectangle; workArea: Rectangle; scaleFactor: number };
  };

  export const Utils: {
    quit(): void;
    showMessageBox(options: {
      type?: "info" | "warning" | "error" | "question";
      title?: string;
      message?: string;
      buttons?: string[];
    }): Promise<{ response: number }>;
  };

  export const Updater: {
    /** What `Resources/version.json` says of this build; `channel` is `dev`, `canary` or `stable`. */
    localInfo: { channel(): Promise<string> };
  };

  export interface ElectrobunConfig {
    app: {
      name: string;
      identifier: string;
      version: string;
      description?: string;
      urlSchemes?: string[];
    };
    build?: {
      bun?: { entrypoint?: string; define?: Record<string, string> };
      copy?: Record<string, string>;
      mac?: { codesign?: boolean; notarize?: boolean; createDmg?: boolean };
    };
    runtime?: { exitOnLastWindowClosed?: boolean };
  }

  const Electrobun: {
    events: {
      on(name: "before-quit", handler: (event: { response?: { allow: boolean } }) => void): void;
      on(name: string, handler: (event: unknown) => void): void;
    };
  };
  export default Electrobun;
}
