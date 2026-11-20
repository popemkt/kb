/**
 * The desktop core over a stand-in shell and a stand-in kb: one window per
 * store on its host's page, deep links, quick capture to the right host, and
 * window memory across a restart.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { currentHome } from "@kb/workspace-fs";
import {
  CaptureClient,
  Desktop,
  DesktopLive,
  DeviceSettings,
  DesktopShell,
  FocusKeeper,
  KbCli,
  DesktopConfig,
  NO_FOCUS_RETURN,
  type KbRunner,
  type MenuEntry,
  type RawCapture,
  type Shell,
  type ShellWindow,
  type SubmitCapture,
  type WindowFrame,
  type WindowSpec,
} from "../src/index.ts";

interface FakeWindow extends ShellWindow {
  readonly spec: WindowSpec;
  url: string;
  closed: boolean;
  focused: number;
  fire: { closed: () => void; navigated: (url: string) => void };
}

function fakeShell() {
  const windows: FakeWindow[] = [];
  const alerts: string[] = [];
  let menu: readonly MenuEntry[] = [];
  let hotkey: (() => void) | null = null;
  let openUrl: ((url: string) => void) | null = null;
  let exited = false;
  const shell: Shell = {
    openWindow(spec) {
      const closed: (() => void)[] = [];
      const navigated: ((url: string) => void)[] = [];
      const w: FakeWindow = {
        spec,
        url: spec.url,
        closed: false,
        focused: 0,
        focus() {
          w.focused += 1;
        },
        close() {
          if (w.closed) return;
          w.closed = true;
          for (const l of closed) l();
        },
        navigate(url) {
          w.url = url;
        },
        frame: () => spec.frame,
        onClosed: (l) => void closed.push(l),
        onFocused: () => {},
        onFrameChanged: () => {},
        onNavigated: (l) => void navigated.push(l),
        fire: { closed: () => w.close(), navigated: (url) => navigated.forEach((l) => l(url)) },
      };
      windows.push(w);
      return w;
    },
    registerHotkey(_accelerator, run) {
      hotkey = run;
      return true;
    },
    setMenu(entries) {
      menu = entries;
    },
    onOpenUrl(l) {
      openUrl = l;
    },
    onReopen() {},
    onQuitRequested() {},
    alert: (message) => void alerts.push(message),
    exit() {
      exited = true;
    },
    workArea: (): WindowFrame => ({ x: 0, y: 0, width: 1440, height: 900 }),
  };
  return {
    shell,
    windows,
    alerts,
    menu: () => menu,
    pressHotkey: () => hotkey?.(),
    openUrl: (url: string) => openUrl?.(url),
    exited: () => exited,
    open: () => windows.filter((w) => !w.closed),
  };
}

const ALPHA = "01M7QSY933AGWWK11NDYJB7P1D";

/** A kb whose home lists one location, Alpha, served at port 4999 once opened. */
function fakeKb(): KbRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    inUse: { kb: { source: "path", file: "/fake/bin/kb" }, skipped: [] },
    run(_root, args) {
      calls.push([...args]);
      if (args[0] === "locations")
        return Effect.succeed({
          status: "succeeded",
          output: {
            rows: [{ id: ALPHA, label: "Alpha", path: "/nowhere/alpha", status: "closed" }],
          },
        });
      if (args[0] === "open")
        return Effect.succeed({ status: "succeeded", output: { url: "http://127.0.0.1:4999" } });
      return Effect.succeed({
        status: "failed",
        code: "invalid_input",
        message: `unexpected ${args.join(" ")}`,
      });
    },
  };
}

let dir = "";
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kb-desktop-app-"));
  // The test preload names a scratch home; give it a store so the locations are listed.
  mkdirSync(join(await Effect.runPromise(currentHome), ".kb"), { recursive: true });
});

async function started(
  submitted: { origin: string; capture: RawCapture }[] = [],
  submit: SubmitCapture = (host, capture) =>
    Effect.sync(() => {
      submitted.push({ origin: host.origin, capture });
      return { ok: true, nodeId: "n1", store: "Alpha" } as const;
    }),
  kb: KbRunner & { calls: string[][] } = fakeKb(),
) {
  const ui = fakeShell();
  const config = new DesktopConfig(dir);
  const services = Layer.mergeAll(
    Layer.succeed(DesktopShell, ui.shell),
    Layer.succeed(DeviceSettings, config),
    Layer.succeed(KbCli, kb),
    Layer.succeed(FocusKeeper, NO_FOCUS_RETURN),
    Layer.succeed(CaptureClient, { submit }),
  );
  const app = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Desktop;
    }).pipe(Effect.provide(DesktopLive.pipe(Layer.provide(services)))),
  );
  await Effect.runPromise(app.start);
  return { ui, app, kb, config };
}

/** Open the quick-capture panel by its hotkey, and a caller of the control server with its token. */
async function capturePanel(
  ui: ReturnType<typeof fakeShell>,
  app: { control(): { readonly origin: string } },
) {
  ui.pressHotkey();
  await Bun.sleep(0);
  const panel = ui.open().find((w) => w.spec.floating);
  const token = new URL(panel?.url ?? "").searchParams.get("t") ?? "";
  const call = (path: string, body?: unknown) =>
    fetch(`${app.control().origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-kb-desktop": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => r.json());
  return { panel, call };
}

describe("DesktopApp", () => {
  test("with nothing remembered it shows the store list, and the menu lists the stores", async () => {
    const { ui, app } = await started();
    expect(ui.open().map((w) => w.spec.title)).toEqual(["kb stores"]);
    expect(ui.open()[0]?.url).toStartWith(`${app.control().origin}/stores?t=`);
    const [open] = ui.menu();
    expect(
      open?.kind === "submenu" ? open.entries.map((e) => (e.kind === "item" ? e.label : "")) : [],
    ).toEqual(["Alpha"]);
    await Effect.runPromise(app.settle);
  });

  test("a store opens once, on the page its host serves", async () => {
    const { ui, app, kb } = await started();
    await Effect.runPromise(
      Effect.all([app.openStore(ALPHA), app.openStore("alpha")], { concurrency: "unbounded" }),
    );
    const stores = ui.open().filter((w) => w.spec.title === "Alpha — kb");
    expect(stores).toHaveLength(1);
    expect(stores[0]?.url).toBe("http://127.0.0.1:4999/");
    expect(kb.calls.filter(([verb]) => verb === "open")).toEqual([["open", ALPHA, "--no-browser"]]);
    await Effect.runPromise(app.settle);
  });

  test("a deep link opens the node in the store's window", async () => {
    const { ui, app } = await started();
    await Effect.runPromise(app.openLink(`kb://open/Alpha/01NODE`));
    const window = ui.open().find((w) => w.spec.title === "Alpha — kb");
    expect(window?.url).toBe("http://127.0.0.1:4999/node/01NODE");
    await Effect.runPromise(app.openLink("kb://open/Alpha/01OTHER"));
    expect(window?.url).toBe("http://127.0.0.1:4999/node/01OTHER");
    await Effect.runPromise(app.openLink("kb://open/Nope/01X"));
    expect(ui.alerts.at(-1)).toContain("no store named Nope");
    await Effect.runPromise(app.settle);
  });

  test("quick capture sends the raw text to the capture store's host and closes", async () => {
    const submitted: { origin: string; capture: RawCapture }[] = [];
    const { ui, app } = await started(submitted);
    const { panel, call } = await capturePanel(ui, app);
    expect(panel?.url).toStartWith(`${app.control().origin}/capture?t=`);
    expect(await call("/api/capture/target")).toEqual({ name: "Alpha" });
    expect(await call("/api/capture", { text: "buy milk\n" })).toEqual({ nodeId: "n1" });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.origin).toBe("http://127.0.0.1:4999");
    expect(submitted[0]?.capture).toMatchObject({
      version: 1,
      text: "buy milk\n",
      source: { app: "kb desktop" },
    });
    expect(panel?.closed).toBe(true);
    // Without the session's token the control server refuses.
    const refused = await fetch(`${app.control().origin}/api/capture`, {
      method: "POST",
      body: "{}",
    });
    expect(refused.status).toBe(403);
    await Effect.runPromise(app.settle);
  });

  test("a retry after a lost answer resends the same capture, so the host makes one node", async () => {
    // A host that commits each capture once by its id, and loses its first answer.
    const nodes = new Map<string, string>();
    const ids: string[] = [];
    const submit: SubmitCapture = (_host, capture) =>
      Effect.sync(() => {
        ids.push(capture.captureId);
        const known = nodes.get(capture.captureId);
        if (known !== undefined) return { ok: true, nodeId: known, store: "Alpha" } as const;
        nodes.set(capture.captureId, `n${nodes.size + 1}`);
        return { ok: false, message: "the host did not answer in time" } as const;
      });
    const { ui, app } = await started([], submit);
    const { panel, call } = await capturePanel(ui, app);
    expect(await call("/api/capture", { text: "call Ana" })).toEqual({
      error: "the host did not answer in time",
    });
    expect(panel?.closed).toBe(false);
    expect(await call("/api/capture", { text: "call Ana" })).toEqual({ nodeId: "n1" });
    expect(nodes.size).toBe(1);
    expect(ids[1]).toBe(ids[0]);

    // Text changed after a failure is a new capture, with its own id.
    const next = await capturePanel(ui, app);
    await next.call("/api/capture", { text: "call Ana" });
    await next.call("/api/capture", { text: "call Ana today" });
    expect(new Set(ids.slice(2)).size).toBe(2);
    expect(ids.slice(2)).not.toContain(ids[0]);
    await Effect.runPromise(app.settle);
  });

  test("windows open at quit reopen at launch, where their page stood", async () => {
    const first = await started();
    await Effect.runPromise(first.app.openStore(ALPHA));
    first.ui
      .open()
      .find((w) => w.spec.title === "Alpha — kb")
      ?.fire.navigated("http://127.0.0.1:4999/node/01KEPT");
    await Effect.runPromise(first.app.quit);
    expect(first.ui.exited()).toBe(true);
    const second = await started();
    expect(second.ui.open().map((w) => w.url)).toEqual(["http://127.0.0.1:4999/node/01KEPT"]);
    // Closing it by hand forgets that it was open.
    second.ui.open()[0]?.fire.closed();
    expect(second.config.openWindows()).toEqual([]);
    await Effect.runPromise(second.app.settle);
  });
});

describe("the store list page", () => {
  test("a kb that cannot list the stores is an answer that says why and which kb ran", async () => {
    const broken = fakeKb();
    const kb: KbRunner & { calls: string[][] } = {
      calls: broken.calls,
      inUse: {
        kb: { source: "checkout", file: "/src/kb/bin/kb" },
        skipped: [
          { kb: { source: "setting", file: "/gone/kb" }, why: "there is no file at /gone/kb" },
        ],
      },
      run: (root, args) =>
        args[0] === "locations"
          ? Effect.succeed({
              status: "failed",
              code: "internal",
              message: 'kb exited 127: bun: not found. Set "kb" in settings.json …',
            })
          : broken.run(root, args),
    };
    const { ui, app } = await started([], undefined, kb);
    const page = ui.open().find((w) => w.spec.title === "kb stores");
    const token = new URL(page?.url ?? "").searchParams.get("t") ?? "";
    const answer = await fetch(`${app.control().origin}/api/stores`, {
      headers: { "x-kb-desktop": token },
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({
      stores: [],
      problem: 'kb locations: kb exited 127: bun: not found. Set "kb" in settings.json …',
      kb: "/src/kb/bin/kb (the checkout the app was built from)",
      passedOver: ['/gone/kb ("kb" in settings.json): there is no file at /gone/kb'],
    });
    await Effect.runPromise(app.settle);
  });
});
