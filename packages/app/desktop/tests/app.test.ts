/**
 * The desktop core over a stand-in shell and a stand-in kb: one window per
 * store on its host's page, deep links, quick capture to the right host, and
 * window memory across a restart.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { KeychainError } from "@kb/keychain";
import { currentHome } from "@kb/workspace-fs";
import {
  CaptureClient,
  CredentialKeychain,
  Desktop,
  DesktopLive,
  DeviceSettings,
  DesktopShell,
  FocusKeeper,
  KbCli,
  DesktopConfig,
  NO_FOCUS_RETURN,
  type CaptureSubmit,
  type KbRunner,
  type MenuEntry,
  type PairWithHost,
  type Shell,
  type ShellWindow,
  type SubmitCapture,
  type WindowFrame,
  type WindowSpec,
} from "../src/index.ts";
import { noKbMessage } from "../src/core/kb-command.ts";
import { memoryKeychain } from "./memory-keychain.ts";

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
    inUse: Effect.succeed({ kb: { source: "path", file: "/fake/bin/kb" }, skipped: [] }),
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
  submitted: { origin: string; capture: CaptureSubmit }[] = [],
  submit: SubmitCapture = (host, capture) =>
    Effect.sync(() => {
      submitted.push({ origin: host.origin, capture });
      return { ok: true, nodeId: "n1", store: "Alpha" } as const;
    }),
  kb: KbRunner & { calls: string[][] } = fakeKb(),
  pair: PairWithHost = () => Effect.succeed({ ok: false, message: "no host here" } as const),
  keychain = memoryKeychain(),
) {
  const ui = fakeShell();
  const config = new DesktopConfig(dir);
  const services = Layer.mergeAll(
    Layer.succeed(DesktopShell, ui.shell),
    Layer.succeed(DeviceSettings, config),
    Layer.succeed(KbCli, kb),
    Layer.succeed(FocusKeeper, NO_FOCUS_RETURN),
    Layer.succeed(CaptureClient, { pair, submit }),
    Layer.succeed(CredentialKeychain, keychain),
  );
  const app = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Desktop;
    }).pipe(Effect.provide(DesktopLive.pipe(Layer.provide(services)))),
  );
  await Effect.runPromise(app.start);
  return { ui, app, kb, config, keychain };
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
    const submitted: { origin: string; capture: CaptureSubmit }[] = [];
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

/** A host that refuses every pairing code. */
const refusesCode: PairWithHost = () =>
  Effect.succeed({
    ok: false,
    message: "capture pairing code is invalid, expired or already used",
  } as const);

describe("a paired remote store", () => {
  const HOST = "https://work.tail.ts.net";
  const CODE = "0123456789abcdef0123456789abcdef";
  const TOKEN = `kbcap_${"a".repeat(64)}`;

  test("a legacy remote needs pairing and re-pairs in place", async () => {
    const legacy = { key: "legacy", name: "My Work", origin: HOST };
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({ remotes: [{ ...legacy, token: "old" }], captureStore: legacy.key }),
    );
    const pair: PairWithHost = () =>
      Effect.succeed({
        ok: true,
        token: TOKEN,
        deviceId: "dev-1",
        store: { key: "01WORK", name: "Work" },
        accepts: [1],
      });
    const { ui, app, config } = await started([], undefined, fakeKb(), pair);
    const { call } = await capturePanel(ui, app);
    expect(await call("/api/stores")).toMatchObject({
      captureStore: legacy.key,
      stores: expect.arrayContaining([{ ...legacy, kind: "remote", contract: "Needs pairing" }]),
    });
    expect(await call("/api/capture", { text: "from the desk" })).toEqual({
      error:
        "My Work needs pairing. Pair this store again in Stores using the same origin and a new code from its host.",
    });
    expect(await call("/api/stores/add-remote", { origin: HOST, code: CODE })).toEqual({
      ok: true,
    });
    expect(config.settings.remotes).toEqual([{ ...legacy, deviceId: "dev-1", accepts: [1] }]);
    await Effect.runPromise(app.settle);
  });

  test("pairs with a code, keeps the credential in the keychain only, and captures with it", async () => {
    const paired: { origin: string; code: string; deviceName: string }[] = [];
    const pair: PairWithHost = (origin, code, deviceName) =>
      Effect.sync(() => {
        paired.push({ origin, code, deviceName });
        return {
          ok: true,
          token: TOKEN,
          deviceId: "dev-1",
          store: { key: "01WORK", name: "Work" },
          accepts: [1],
        } as const;
      });
    const submitted: { origin: string; token?: string }[] = [];
    const submit: SubmitCapture = (host) =>
      Effect.sync(() => {
        submitted.push(host);
        return { ok: true, nodeId: "n9", store: "Work" } as const;
      });
    const memory = memoryKeychain();
    let refuseErase = true;
    const { ui, app, config, keychain } = await started([], submit, fakeKb(), pair, {
      ...memory,
      erase: (item) =>
        refuseErase
          ? Effect.fail(new KeychainError({ message: "security refused to delete the item" }))
          : memory.erase(item),
    });
    const { call } = await capturePanel(ui, app);

    expect(
      await call("/api/stores/add-remote", {
        name: "",
        origin: `${HOST}/x`,
        code: ` ${CODE.toUpperCase()} `,
      }),
    ).toEqual({ ok: true });
    expect(paired).toEqual([
      { origin: HOST, code: CODE, deviceName: expect.stringMatching(/^kb desktop on /) },
    ]);
    const pairedRemotes = config.settings.remotes;
    const [remote] = pairedRemotes;
    expect(remote).toMatchObject({ name: "Work", origin: HOST, deviceId: "dev-1", accepts: [1] });
    expect(JSON.stringify(config.settings)).not.toContain(TOKEN);
    expect([...keychain.items]).toEqual([[`kb-desktop/${remote?.key}`, TOKEN]]);

    const listed = (await call("/api/stores")) as { stores: { kind: string }[] };
    expect(listed.stores.find((s) => s.kind === "remote")).toMatchObject({
      name: "Work",
      contract: "Accepts v1 · in step with this app",
    });

    await call("/api/settings/capture-store", { key: remote?.key });
    expect(
      await (await capturePanel(ui, app)).call("/api/capture", { text: "from the desk" }),
    ).toEqual({ nodeId: "n9" });
    expect(submitted).toEqual([{ origin: HOST, token: TOKEN }]);

    expect(await call("/api/stores/remove", { key: remote?.key })).toEqual({
      error:
        "Could not forget Work: its keychain credential could not be erased (security refused to delete the item). Try Forget again.",
    });
    expect(await call("/api/stores")).toMatchObject({
      stores: expect.arrayContaining([expect.objectContaining({ key: remote?.key })]),
    });
    expect(new DesktopConfig(dir).settings.remotes).toEqual(pairedRemotes);
    expect(keychain.items.size).toBe(1);

    refuseErase = false;
    expect(await call("/api/stores/remove", { key: remote?.key })).toEqual({ ok: true });
    expect(config.settings.remotes).toEqual([]);
    expect(keychain.items.size).toBe(0);
    await Effect.runPromise(app.settle);
  });

  test("a code that is not one, or a host that refuses it, adds nothing", async () => {
    const { ui, app, config, keychain } = await started([], undefined, fakeKb(), refusesCode);
    const { call } = await capturePanel(ui, app);
    const badCode = (await call("/api/stores/add-remote", { origin: HOST, code: "1234" })) as {
      error: string;
    };
    expect(badCode.error).toContain("a pairing code is 32 hex characters");
    expect(await call("/api/stores/add-remote", { origin: HOST, code: CODE })).toEqual({
      error: `could not pair with ${HOST}: capture pairing code is invalid, expired or already used`,
    });
    expect(config.settings.remotes).toEqual([]);
    expect(keychain.items.size).toBe(0);
    await Effect.runPromise(app.settle);
  });
});

describe("the store list page", () => {
  test("a kb that cannot list the stores is an answer that says why and which kb ran", async () => {
    const broken = fakeKb();
    const kb: KbRunner & { calls: string[][] } = {
      calls: broken.calls,
      inUse: Effect.succeed({
        kb: { source: "checkout", file: "/src/kb/bin/kb" },
        skipped: [
          { kb: { source: "setting", file: "/gone/kb" }, why: "there is no file at /gone/kb" },
        ],
      }),
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

  test("with no kb that runs, the app starts and its store list says what it tried", async () => {
    const skipped = [
      { kb: { source: "path", file: "/old/bin/kb" }, why: "kb 0.3.1 speaks wire protocol 12" },
    ] as const;
    const calls: string[][] = [];
    const kb: KbRunner & { calls: string[][] } = {
      calls,
      inUse: Effect.succeed({ kb: null, skipped }),
      run: (_root, args) => {
        calls.push([...args]);
        return Effect.succeed({
          status: "failed",
          code: "internal",
          message: noKbMessage(skipped, "/s.json"),
        });
      },
    };
    const { ui, app } = await started([], undefined, kb);
    expect(ui.exited()).toBe(false);
    const page = ui.open().find((w) => w.spec.title === "kb stores");
    const token = new URL(page?.url ?? "").searchParams.get("t") ?? "";
    const answer = await fetch(`${app.control().origin}/api/stores`, {
      headers: { "x-kb-desktop": token },
    });
    const listed = (await answer.json()) as { problem: string; kb: string; passedOver: string[] };
    expect(listed.kb).toBe("none that runs");
    expect(listed.problem).toContain("kb desktop found no kb that runs:");
    expect(listed.passedOver).toEqual([
      "/old/bin/kb (kb on the PATH): kb 0.3.1 speaks wire protocol 12",
    ]);
    await Effect.runPromise(app.settle);
  });
});
