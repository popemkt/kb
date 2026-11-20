/**
 * The desktop app, shell-agnostic: one window per store showing that
 * store's own kb page, a quick-capture panel on a global hotkey, a menu
 * (tray and application) and `kb://open/…` links. The shell draws; this
 * decides. A shell event runs its effect on the shell's thread of control
 * (`Effect.runFork`), and a refusal it meets is shown with `shell.alert`.
 */
import { Context, DateTime, Deferred, Effect, Layer } from "effect";
import {
  contractStatus,
  textCapture,
  type CaptureOutcome,
  type RawCapture,
  type SubmitCapture,
} from "./capture.ts";
import type { DesktopConfig } from "./config.ts";
import { startControlServer, type ControlActions, type ControlServer } from "./control.ts";
import { nodePagePath, parseDeepLink } from "./deep-link.ts";
import type { FocusReturn } from "./focus.ts";
import { describeKb, type KbInUse } from "./kb-command.ts";
import { CaptureClient, DeviceSettings, DesktopShell, FocusKeeper, KbCli } from "./services.ts";
import type { MenuEntry, Shell, ShellWindow, WindowFrame } from "./shell.ts";
import { findStore, StoreDirectory, StoreError, type Store, type Stores } from "./stores.ts";

const STORE_WINDOW = { width: 1200, height: 820 };
const CAPTURE_PANEL = { width: 560, height: 170 };
const STORES_WINDOW = { width: 760, height: 620 };

export interface DesktopApp {
  /** Start: the control server, the hotkey, the menu, and the windows open at last quit. */
  readonly start: Effect.Effect<void>;
  /** Where the desktop's own pages are served; there once started. */
  readonly control: () => ControlServer;
  /**
   * Show `key`'s store: focus its window, or open one on its host (started
   * when nothing serves a local store). With `path`, the page goes there.
   */
  readonly openStore: (key: string, path?: string) => Effect.Effect<void, StoreError>;
  /** Follow a `kb://open/<store>/<node>` link: navigation only. */
  readonly openLink: (url: string) => Effect.Effect<void>;
  /** Show the quick-capture panel over the app in front, remembering that app. */
  readonly showCapture: Effect.Effect<void>;
  /** Send `text` to the capture store's host. */
  readonly capture: (text: string) => Effect.Effect<CaptureOutcome, StoreError>;
  readonly showStores: Effect.Effect<void>;
  /**
   * Settle before exit: wait for captures in flight, close every window, and
   * stop the hosts this app started (when the setting says so). Idempotent.
   */
  readonly settle: Effect.Effect<void>;
  /** Settle, then exit. */
  readonly quit: Effect.Effect<void>;
}

/** Where a new window goes: centred in the work area, cascaded by `index`. */
export function placeWindow(
  area: WindowFrame,
  size: { width: number; height: number },
  index = 0,
): WindowFrame {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const offset = (index % 6) * 28;
  return {
    x: area.x + Math.max(0, Math.round((area.width - width) / 2)) + offset,
    y: area.y + Math.max(0, Math.round((area.height - height) / 3)) + offset,
    width,
    height,
  };
}

/** The path part of `url` when it is on `origin`, for remembering where a page stood. */
export function pagePath(url: string, origin: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
  } catch {
    return null;
  }
}

/** A window over a store: the store it shows and the origin its page came from. */
interface StoreWindow {
  readonly window: ShellWindow;
  readonly store: Store;
  readonly origin: string;
}

/**
 * A capture sent and not yet confirmed. Sending the same text again resends
 * this envelope (its id, its time and its store), so a host that committed it
 * but whose answer was lost answers with the same receipt instead of making
 * a second node. Changed text is a new capture; closing the panel abandons it.
 */
interface PendingCapture {
  readonly text: string;
  readonly store: Store;
  readonly capture: RawCapture;
}

/** What the app's parts share: its services, and the state of its windows. */
interface Ctx {
  readonly shell: Shell;
  readonly config: DesktopConfig;
  readonly stores: Stores;
  /** The kb the store list runs, which the list names. */
  readonly kb: KbInUse;
  readonly focus: FocusReturn;
  readonly submit: SubmitCapture;
  readonly windows: Map<string, StoreWindow>;
  /** Stores being opened, so two requests for one store make one window. */
  readonly opening: Map<string, Deferred.Deferred<StoreWindow, StoreError>>;
  /** Captures in flight, which quitting waits for. */
  readonly captures: Set<Deferred.Deferred<void>>;
  /** Redraw the menu (it names the parts' effects, so it is read lazily). */
  readonly refreshMenu: Effect.Effect<void>;
  control: ControlServer | null;
  capturePanel: ShellWindow | null;
  pendingCapture: PendingCapture | null;
  storesWindow: ShellWindow | null;
  lastFocused: string | null;
  quitting: boolean;
}

/** Run `effect` for a shell event; a refusal is shown to the person. */
function fire<E extends { readonly message: string }>(
  ctx: Ctx,
  effect: Effect.Effect<void, E>,
): void {
  Effect.runFork(
    effect.pipe(Effect.catch((err: E) => Effect.sync(() => ctx.shell.alert(err.message)))),
  );
}

function controlOf(ctx: Ctx): ControlServer {
  if (ctx.control === null) throw new Error("the desktop app has not started");
  return ctx.control;
}

/** The store windows: open one per store, follow links into them, and the store list. */
function storeWindows(ctx: Ctx) {
  const { shell, config, stores, windows, opening } = ctx;

  const storeOf = Effect.fn("kb.desktop.app.store")(function* (key: string) {
    const store = yield* stores.find(key);
    if (store === undefined) return yield* new StoreError({ message: `no store named ${key}` });
    return store;
  });

  const openWindow = Effect.fn("kb.desktop.app.openWindow")(function* (
    store: Store,
    path?: string,
  ) {
    const origin = yield* stores.origin(store);
    const memory = config.window(store.key);
    const frame = memory?.frame ?? placeWindow(shell.workArea(), STORE_WINDOW, windows.size);
    const url = `${origin}${path ?? memory?.path ?? "/"}`;
    const window = shell.openWindow({ title: `${store.name} — kb`, url, frame, floating: false });
    windows.set(store.key, { window, store, origin });
    ctx.lastFocused = store.key;
    config.rememberWindow(store.key, { frame, open: true });
    window.onFocused(() => {
      ctx.lastFocused = store.key;
    });
    window.onFrameChanged((next) => config.rememberWindow(store.key, { frame: next }));
    // GAP [[01M7QTTSVH7B0ND5PTVD0475SB]]: a host on a new port starts with empty page storage, so the path is kept here.
    window.onNavigated((at) => {
      const kept = pagePath(at, origin);
      if (kept !== null) config.rememberWindow(store.key, { path: kept });
    });
    window.onClosed(() => {
      windows.delete(store.key);
      // A window closed by quitting stays "open", so it reopens at launch.
      if (!ctx.quitting) config.rememberWindow(store.key, { open: false });
    });
    yield* ctx.refreshMenu;
    return { window, store, origin };
  });

  const openStore = Effect.fn("kb.desktop.app.openStore")(function* (key: string, path?: string) {
    const store = yield* storeOf(key);
    const open = windows.get(store.key);
    if (open !== undefined) {
      if (path !== undefined) open.window.navigate(`${open.origin}${path}`);
      open.window.focus();
      return;
    }
    const joined = opening.get(store.key);
    if (joined !== undefined) {
      (yield* Deferred.await(joined)).window.focus();
      return;
    }
    const answer = Deferred.makeUnsafe<StoreWindow, StoreError>();
    opening.set(store.key, answer);
    const exit = yield* Effect.exit(openWindow(store, path));
    opening.delete(store.key);
    yield* Deferred.done(answer, exit);
    (yield* exit).window.focus();
  });

  const openLink = Effect.fn("kb.desktop.app.openLink")(function* (url: string) {
    const link = parseDeepLink(url);
    if (link === null) {
      shell.alert(`kb cannot open ${url}`);
      return;
    }
    yield* openStore(link.store, link.node === null ? undefined : nodePagePath(link.node)).pipe(
      Effect.catch((err) => Effect.sync(() => shell.alert(err.message))),
    );
  });

  const showStores = Effect.sync(() => {
    if (ctx.storesWindow !== null) {
      ctx.storesWindow.focus();
      return;
    }
    const window = shell.openWindow({
      title: "kb stores",
      url: controlOf(ctx).pageUrl("stores"),
      frame: placeWindow(shell.workArea(), STORES_WINDOW),
      floating: false,
    });
    ctx.storesWindow = window;
    window.onClosed(() => {
      if (ctx.storesWindow === window) ctx.storesWindow = null;
    });
    window.focus();
  });

  return { storeOf, openStore, openLink, showStores };
}

/** Quick capture: the panel, the store it sends to, and the send. */
function quickCapture(ctx: Ctx) {
  const { shell, config, stores, focus, windows } = ctx;

  /** The store quick capture sends to: the chosen one, else the last focused, else the first. */
  const captureStore = Effect.gen(function* () {
    const all = yield* stores.list;
    const preferred = [config.settings.captureStore, ctx.lastFocused].filter(
      (k): k is string => k !== undefined && k !== null && k !== "",
    );
    const store =
      preferred.map((key) => findStore(all, key)).find((s) => s !== undefined) ?? all[0];
    if (store === undefined)
      return yield* new StoreError({
        message: "there is no store to capture to yet; add one in Stores…",
      });
    return store;
  });

  const showCapture = Effect.gen(function* () {
    if (ctx.capturePanel !== null) {
      ctx.capturePanel.focus();
      return;
    }
    yield* focus.remember;
    const panel = shell.openWindow({
      title: "Quick capture",
      url: controlOf(ctx).pageUrl("capture"),
      frame: placeWindow(shell.workArea(), CAPTURE_PANEL),
      floating: true,
    });
    ctx.capturePanel = panel;
    panel.onClosed(() => {
      if (ctx.capturePanel !== panel) return;
      ctx.capturePanel = null;
      ctx.pendingCapture = null;
    });
    panel.focus();
  });

  /** Close the panel and give the keyboard back to the app that had it. */
  const closeCapture = Effect.gen(function* () {
    const panel = ctx.capturePanel;
    ctx.capturePanel = null;
    ctx.pendingCapture = null;
    panel?.close();
    yield* focus.restore;
  });

  /** The envelope for `text`: the pending one when it is the same text, else a new capture. */
  const envelope = Effect.fn("kb.desktop.app.envelope")(function* (text: string) {
    if (ctx.pendingCapture !== null && ctx.pendingCapture.text === text) return ctx.pendingCapture;
    const store = yield* captureStore;
    const now = yield* DateTime.now;
    const pending = { text, store, capture: textCapture(text, now, crypto.randomUUID()) };
    ctx.pendingCapture = pending;
    return pending;
  });

  const send = Effect.fn("kb.desktop.app.send")(function* (text: string) {
    const { store, capture } = yield* envelope(text);
    const origin = windows.get(store.key)?.origin ?? (yield* stores.origin(store));
    const token = yield* stores.credential(store);
    const outcome = yield* ctx.submit(
      { origin, ...(token === undefined ? {} : { token }) },
      capture,
    );
    if (outcome.ok && ctx.pendingCapture?.capture === capture) ctx.pendingCapture = null;
    return outcome;
  });

  /** Send, counted as in flight until the host has answered. */
  const capture = (text: string): Effect.Effect<CaptureOutcome, StoreError> =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const done = Deferred.makeUnsafe<void>();
        ctx.captures.add(done);
        return done;
      }),
      () => send(text),
      (done) =>
        Effect.andThen(
          Deferred.succeed(done, undefined),
          Effect.sync(() => ctx.captures.delete(done)),
        ),
    );

  return { captureStore, showCapture, closeCapture, capture };
}

/** Settle and quit: captures first, then windows, then the hosts this app started. */
function lifecycle(ctx: Ctx) {
  const settled = Deferred.makeUnsafe<void>();
  const settle = Effect.gen(function* () {
    if (ctx.quitting) {
      yield* Deferred.await(settled);
      return;
    }
    ctx.quitting = true;
    yield* Effect.forEach([...ctx.captures], Deferred.await, { discard: true });
    for (const { window } of ctx.windows.values()) window.close();
    ctx.capturePanel?.close();
    ctx.storesWindow?.close();
    if (ctx.config.settings.stopStartedHostsOnQuit)
      yield* Effect.forEach(ctx.stores.started(), (root) => ctx.stores.stopStarted(root), {
        concurrency: "unbounded",
        discard: true,
      });
    ctx.control?.stop();
    yield* Deferred.succeed(settled, undefined);
  });
  const quit = Effect.andThen(
    settle,
    Effect.sync(() => ctx.shell.exit()),
  );
  return { settle, quit };
}

type Windows = ReturnType<typeof storeWindows>;
type Capture = ReturnType<typeof quickCapture>;

/** The menu: one item per store, quick capture, the store list, quit. */
function menu(ctx: Ctx, w: Windows, c: Capture, quit: Effect.Effect<void>): Effect.Effect<void> {
  return Effect.gen(function* () {
    const all = yield* ctx.stores.list.pipe(Effect.orElseSucceed((): Store[] => []));
    const item = (label: string, effect: Effect.Effect<void, StoreError>): MenuEntry => ({
      kind: "item",
      label,
      run: () => fire(ctx, effect),
    });
    ctx.shell.setMenu([
      {
        kind: "submenu",
        label: "Open store",
        entries:
          all.length === 0
            ? [item("No stores yet…", w.showStores)]
            : all.map((s) => item(s.name, w.openStore(s.key))),
      },
      item("Quick capture", c.showCapture),
      item("Stores…", w.showStores),
      { kind: "divider" },
      item("Quit kb", quit),
    ]);
  });
}

/** What the desktop's own pages may ask (`control.ts`). */
function pageActions(ctx: Ctx, w: Windows, c: Capture): ControlActions {
  const { config, stores, refreshMenu } = ctx;
  return {
    // A list that cannot be read is an answer too: the page shows why in
    // place of the stores, with the kb it ran, instead of waiting forever.
    listStores: stores.list.pipe(
      Effect.map((all) => ({
        stores: all.map((store) =>
          store.kind === "remote" ? { ...store, contract: contractStatus(store.accepts) } : store,
        ),
        problem: "",
      })),
      Effect.catch((err: StoreError) => Effect.succeed({ stores: [], problem: err.message })),
      Effect.map((listed) => ({
        ...listed,
        kb: describeKb(ctx.kb.kb),
        passedOver: ctx.kb.skipped.map(({ kb, why }) => `${describeKb(kb)}: ${why}`),
        captureStore: config.settings.captureStore ?? "",
        hotkey: config.settings.hotkey,
      })),
    ),
    openStore: (key) => w.openStore(key),
    addLocal: (path, name) =>
      path === ""
        ? Effect.fail(new StoreError({ message: "give the root's path" }))
        : Effect.andThen(stores.addLocal(path, name), refreshMenu),
    addRemote: (name, origin, code) =>
      Effect.andThen(stores.addRemote(name, origin, code), refreshMenu),
    removeStore: (key) =>
      w.storeOf(key).pipe(
        Effect.flatMap((store) => stores.remove(store)),
        Effect.andThen(refreshMenu),
      ),
    setCaptureStore: (key) =>
      Effect.sync(() => {
        config.updateSettings(({ captureStore: _, ...rest }) =>
          key === "" ? rest : { ...rest, captureStore: key },
        );
      }),
    captureTarget: Effect.map(c.captureStore, (store) => ({ name: store.name })),
    capture: (text) =>
      c
        .capture(text)
        .pipe(
          Effect.flatMap((outcome) =>
            outcome.ok
              ? Effect.as(c.closeCapture, { nodeId: outcome.nodeId })
              : Effect.fail(new StoreError({ message: outcome.message })),
          ),
        ),
    closeCapture: c.closeCapture,
  };
}

/** Start: the control server, the hotkey, OS events, the menu, and the windows open at last quit. */
function starting(
  ctx: Ctx,
  w: Windows,
  c: Capture,
  settle: Effect.Effect<void>,
): Effect.Effect<void> {
  const { shell, config } = ctx;
  return Effect.gen(function* () {
    ctx.control = startControlServer(pageActions(ctx, w, c));
    const hotkey = config.settings.hotkey;
    if (!shell.registerHotkey(hotkey, () => fire(ctx, c.showCapture)))
      shell.alert(
        `The quick-capture hotkey ${hotkey} is taken; use the menu, or set "hotkey" in ${config.dir}/settings.json.`,
      );
    shell.onOpenUrl((url) => fire(ctx, w.openLink(url)));
    shell.onReopen(() => {
      if (ctx.windows.size === 0) fire(ctx, w.showStores);
    });
    shell.onQuitRequested(settle);
    yield* ctx.refreshMenu;
    const reopened = yield* Effect.forEach(
      config.openWindows(),
      (key) =>
        w.openStore(key).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        ),
      { concurrency: "unbounded" },
    );
    if (!reopened.includes(true)) yield* w.showStores;
  });
}

function desktopApp(
  services: Pick<Ctx, "shell" | "config" | "stores" | "kb" | "focus" | "submit">,
): DesktopApp {
  let drawMenu: Effect.Effect<void> = Effect.void;
  const ctx: Ctx = {
    ...services,
    windows: new Map(),
    opening: new Map(),
    captures: new Set(),
    refreshMenu: Effect.suspend(() => drawMenu),
    control: null,
    capturePanel: null,
    pendingCapture: null,
    storesWindow: null,
    lastFocused: null,
    quitting: false,
  };
  const w = storeWindows(ctx);
  const c = quickCapture(ctx);
  const { settle, quit } = lifecycle(ctx);
  drawMenu = menu(ctx, w, c, quit);
  return {
    start: starting(ctx, w, c, settle),
    control: () => controlOf(ctx),
    openStore: w.openStore,
    openLink: w.openLink,
    showCapture: c.showCapture,
    capture: c.capture,
    showStores: w.showStores,
    settle,
    quit,
  };
}

/** The desktop app over the shell, the settings, the store directory and its kb, focus return and the capture client. */
export class Desktop extends Context.Service<Desktop, DesktopApp>()("@kb/desktop/Desktop") {
  static readonly layer = Layer.effect(
    Desktop,
    Effect.gen(function* () {
      return desktopApp({
        shell: yield* DesktopShell,
        config: yield* DeviceSettings,
        stores: yield* StoreDirectory,
        kb: (yield* KbCli).inUse,
        focus: yield* FocusKeeper,
        submit: (yield* CaptureClient).submit,
      });
    }),
  );
}

/** The desktop app with its store directory, over the services the composition root provides (`services.ts`). */
export const DesktopLive = Desktop.layer.pipe(Layer.provide(StoreDirectory.layer));
