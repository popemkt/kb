# kb desktop (`@kb/desktop`)

kb as a desktop app: one window per store showing that store's own kb page,
a global quick-capture panel, a tray and app menu, and `kb://` links. This is
a first version to try out and change. The plan it follows is
`docs/research/2026-11-18-desktop-and-phone-apps.md` (branch
`research/apps-raw-capture`).

## Run it on a Mac (arm64)

Electrobun builds only for the OS it runs on, so the macOS app has to be
built on the Mac. From a checkout of this branch:

```sh
nix develop            # or any shell with bun 1.4.x
bun install
cd packages/app/desktop
bun run dev            # build and launch a dev build (logs in the terminal)
# or
bun run build:mac      # a stable build: build/stable-macos-arm64/kb.app
open build/*/kb.app    # unsigned, so the first open may need right-click → Open
```

The first build downloads Electrobun's macOS core (about 50 MB) from its
GitHub release into `node_modules/electrobun`.

**Which kb it runs.** The app does not include kb. At launch it tries
these in order and runs the first whose `kb --version --json` names the
wire protocol the app was built with:

1. `"kb"` in `settings.json` (see below)
2. `KB_DESKTOP_KB`
3. a kb release copied into the app (`Resources/app/kb`). `build:mac` copies
   `out/kb-<version>` in when it exists, so run `sh bin/release-bundle`
   first to get it
4. in a stable or canary build (`build:mac`), `kb` on the PATH, then the
   checkout's `bin/kb`; in a dev build (`bun run dev`, `build:app`), the
   checkout's `bin/kb` first, then `kb` on the PATH. The build records the
   path of the checkout it was built from

A kb that does not answer is passed over, never chosen, and so is one that
answers with another wire protocol: an older one is told to update kb, a
newer one to update the app. A kb from before `--json` was asked prints its
version alone and is passed over as older. The protocol is the one a page
and its server must agree on (DESIGN-UI.md → Delivery); it covers
`capture.submit` and `capture.pair`, so a kb that is chosen has the capture
calls this app makes. The ones passed over, and why, are logged and listed
under the store list, which also names the kb in use. When none answers, the app says which it tried and quits. A
kb you named (1 or 2) that is missing is reported the same way, rather than
skipped in silence.

Why a stable build runs the installed kb before the checkout's: a stable
build is the app you use every day, and the installed kb is the one you
chose and pinned (Nix, Homebrew, a release). The checkout's kb is whatever
branch that checkout has checked out today. It needs a Bun and builds its UI
on the first `kb ui`, and the checkout may be a worktree that is gone next
week. A dev build is run while kb itself is being changed, so there the
checkout's kb, the one being changed, comes first. Either way the other one
is still tried, so an app with only one of them runs it.

**PATH.** An app opened from Finder inherits launchd's bare PATH, not your
shell's. Every kb the app runs (the probe, `kb locations`, `kb open`) gets
the same PATH, with the places Nix, Homebrew and bun install to added. The
checkout's `bin/kb` execs `bun` by name, and a Nix dev shell's Bun lives
only in the store, so the build also records the Bun it ran with and adds
its directory last: an installed Bun wins, and the build's Bun is there when
none is. A `kb ui` that kb starts runs on the same Bun as the kb that
started it.

If the store list says it could not list your stores, its message names the
kb that ran. Set `"kb"` in `settings.json` to the full path of a kb that
runs (`command -v kb` in a terminal prints one) and reopen the app.

Quick capture sends to the store's host, which need not be the kb the app
runs: a `kb ui` already serving the root, or a remote store. A host without
`capture.submit` refuses the capture with "update kb" and keeps your text.
Against a host with it, the desktop's envelope was accepted, and a retry
with the same `captureId` returned the same receipt. Multi-line text arrived
intact, and URL text became a link node.

When the app runs from the checkout's kb, `kb ui` builds the UI on its first
start. That can take longer than the 10 seconds `location.open` waits. If
the first open fails, run `cd packages/app/ui && bun run build` once.

## Run it on Linux (how it was tested)

```sh
bun run build:app      # build/dev-linux-x64/kb-dev
build/dev-linux-x64/kb-dev/bin/launcher
```

It needs WebKitGTK 4.1, GTK 3, libsoup 3 and libayatana-appindicator. On
NixOS, nix-ld has to be on, with those libraries in `NIX_LD_LIBRARY_PATH`.
It was tested under Xvfb against scratch stores (`KB_HOME`, `KB_DATA`,
`KB_DESKTOP_HOME` all pointed into `/tmp`).

## What works

- **Stores.** The store list (it opens when no store window does, and from
  the menu) shows your local stores, which are the locations in your home
  store (`kb locations`), and your remote stores, which are origins.
  - Add a local root by path and name. A directory that is not a store gets
    `kb init`.
  - Pair a remote store: its origin and a one-use pairing code its host's
    owner issues with `capture.pairCode` (the store list shows the command;
    a code is good for 10 minutes). The app calls
    `capture.pair`, keeps the device credential it returns in the macOS
    Keychain (service `kb-desktop`, account the store's key; the secret
    service on Linux), never in `settings.json`, and sends it as
    `Authorization: Bearer` with every capture. The row says which capture
    contract the store accepts ("Accepts v1 · in step with this app"). A
    host that refuses the credential asks you to pair again.
  - Forget a store, by clicking Forget twice. Its files are never touched;
    a remote's credential is erased from the keychain.
  - Choose which store quick capture sends to.
- **One window per store**, showing the page that store's own host serves.
  - Local stores open through `kb open <id>`, which reuses a `kb ui`
    already serving the root, or starts one on a free port.
  - Opening the same store twice focuses its window.
  - Windows remember their frame and page path per store. The ones open at
    quit reopen at launch.
- **Quick capture.** `Cmd+Shift+K` (set `hotkey` to change it) opens a small
  panel that stays on top. It shows the target store.
  - **Enter** sends the text as typed to that store's host, as one raw
    `capture.submit` call: `{version: 1, captureId, capturedAt (with your UTC
offset), source: {app: "kb desktop"}, text}`. The host maps the text to
    nodes and places them (today's day by default). On success the panel
    closes.
  - **Shift+Enter** adds a new line. **Escape** closes the panel.
  - When the panel closes, focus goes back to the app you were in (on macOS
    through `lsappinfo` and `open -b`, which need no permission).
  - On failure the text stays and the reason shows. Enter again resends the
    same capture (same `captureId`, time and store), so if the host saved it
    but the answer was lost, it still makes one node. Changing the text
    starts a new capture, and closing the panel drops it.
  - The target is the store you chose, else the store you last focused,
    else the first store.
- **Menu** (the tray, and a "Stores" menu in the menu bar): Open store, Quick
  capture, Stores…, Quit. The standard Edit menu is there too, so ⌘C, ⌘V
  and ⌘Z work in the page.
- **Quit** (the menu, ⌘Q, SIGTERM or Ctrl-C) waits for captures in flight
  and closes the windows. It then stops only the `kb ui` hosts this app
  started, with SIGTERM and then SIGKILL after 5 s. A host that was already
  running is left alone, and so is one that replaced the host this app
  started (another pid or port in `.kb/ui.json`). Set `stopStartedHostsOnQuit: false` to keep the
  hosts running.
- **`kb://open/<store>/<node>`** opens the node in that store's window. The
  store is named by its key or its name. The link only navigates, and a
  store the app does not know opens nothing. The app registers the `kb`
  scheme on macOS.

## Stubbed or missing

- **macOS, partly run.** A stable build opened with launchd's bare PATH
  (as Finder opens it) on an arm64 Mac lists the stores, reopens the store
  windows it had open, shows the menu bar's Stores menu and renders the
  store list in WKWebView, with the installed kb and with the checkout's
  kb on the build's Bun. The tray, `open-url`, dock reopen and focus return
  are not run there yet.
- **Which kb runs.** It is resolved once, at launch
  (GAP `01M7WV5D06HSMA1JFBBRGE0B13`). The checkout and Bun paths a build records are those of the build machine
  (GAP `01M7WV5DQDNMQMR9QYJN839TNJ`).
- **The capture wire is declared twice.** The capture envelope and the
  `capture.pair` answer are written out in `src/core/capture.ts`, matching
  `@kb/contracts` by hand (GAP `01M7QTTTHGVFE32XRVV96A696K`).
- **The contract status is read at pairing.** A remote's accepted capture
  contracts come from its `capture.pair` answer and are not re-read from its
  `kb.manifest`, as the Android app does before it delivers
  (GAP `01M7WZGP3B84JK08R43Y642C7N`).
- **Remote stores are not locations.** They are kept in the desktop's own
  settings (GAP `01M7QTTRFKDF9B7F4M29Z84XJQ`).
- **Page storage across ports.** A local host that comes back on a new port
  starts the page with empty storage, so it loses its tab session and
  layout. The window still reopens at the right path
  (GAP `01M7QTTSVH7B0ND5PTVD0475SB`).
- **Capture is text only.** There are no files, URL fields or drag-in yet.
  The contract supports them.
- No icon, signing, notarization, DMG or auto-update.
- On Linux, a deep link only arrives as a launch argument (there is no
  single-instance handoff). Electrobun has no application menu on Linux.

## Where things live

| Path                                        | What                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`                                 | Everything that decides, independent of the shell: the store list (through one-shot `kb` commands), store windows, quick capture, menu, deep links, quit, and the control server that serves the desktop's own two pages                                              |
| `src/core/shell.ts`                         | The shell port: windows, hotkey, menu, OS events, exit                                                                                                                                                                                                                |
| `src/core/services.ts`                      | The services the composition root provides (shell, settings, kb CLI, focus return, capture client, credential keychain). `Desktop` and `StoreDirectory` are layers over them                                                                                          |
| `src/shell/electrobun/`                     | The Electrobun adapter and entry. Nothing in it decides anything                                                                                                                                                                                                      |
| `~/Library/Application Support/kb-desktop/` | `settings.json` (`kb`, `hotkey`, `captureStore`, `stopStartedHostsOnQuit`, `remotes`: key, name, origin, device id and accepted contracts, never a credential) and `windows.json`. On Linux it is under `$XDG_CONFIG_HOME/kb-desktop`. `KB_DESKTOP_HOME` overrides it |

**Swapping Electrobun for Tauri v2.** The core is plain TypeScript on Bun and
draws its own pages over a loopback control server. The swap would go like
this:

1. Run `src/core` as a Bun sidecar.
2. Write a Tauri adapter that implements `Shell` over its IPC: windows,
   global-shortcut, tray, deep-link and quit. That is about 150 lines of Rust
   glue plus a small TS bridge.
3. Point its webviews at the URLs the core hands out.

Nothing in `core/`, the pages or the kb side changes.
