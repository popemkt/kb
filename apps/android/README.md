# kb for Android

A Capacitor shell around kb's own web UI, plus what only a phone can do.

- **Your store's kb, as it is.** A paired store is the address you open
  its kb at. The app loads that page, the same one a browser shows, so the
  UI is always the store's own kb version. Nothing in the app can drift
  from the web, and a UI change needs no new APK.
- **Capture that works offline.** Pick **kb** in any app's share sheet, or
  tap the home-screen widget or the quick-settings tile. The capture is
  copied into a queue on the phone straight away and delivered later,
  unchanged, to the store's `capture.submit`. The store decides what nodes
  the capture becomes and where they go.
- **The queue instead of a broken page.** When the store's UI does not load
  (offline, the host asleep), the app shows the queue in its place, says
  why, and offers to try again.
- **Told when it matters.** A capture the store refused, or a store that
  stopped accepting this phone, posts a notification.

The design is
[`docs/research/2026-11-20-phone-beyond-capture.md`](../../docs/research/2026-11-20-phone-beyond-capture.md)
§7. The wire contract is the host's `capture.submit` and `capture.pair`
(`DESIGN.md` → Raw capture).

## Build

Everything comes from the repository's flake, so nothing is installed on the
host. The `android` dev shell brings a JDK (21, which Capacitor 8 needs),
Gradle and an Android SDK (platform 36, build-tools 35), with the SDK
licence accepted for that shell only. It is defined for `x86_64-linux` and
`aarch64-darwin`.

```sh
nix develop .#android -c gradle -p apps/android assembleDebug
# → apps/android/app/build/outputs/apk/debug/app-debug.apk
nix develop .#android -c gradle -p apps/android testDebugUnitTest
```

The build needs no npm package and no Capacitor CLI:

- Capacitor's Android runtime is the Maven artifact `com.capacitorjs:core`,
  which ships the JS bridge.
- The shell's own page is static HTML, CSS and JS in
  `app/src/main/assets/public`, beside `capacitor.config.json`.
- Its colours are kb's: Gradle copies `packages/app/ui/src/design-system.css`
  next to the page at build time (`kbDesignSystem`).

The debug APK is signed with the SDK's generated debug key, which is enough
for `adb install`. Nothing here signs with anyone's account or publishes to
a store. The Gradle project is not part of the Bun workspace
(`packages/*/*`): `bun install`, `bun run verify` and Nx do not see it.

## Install

1. On the phone, turn on Developer options, then **USB debugging** (or
   **Wireless debugging**).
2. Install the APK:

   ```sh
   nix develop .#android -c adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
   ```

   Or copy `app-debug.apk` to the phone and open it, allowing installs from that
   source.

## Pair a store

1. Serve the store's kb where the phone can reach it, the way you would
   open it in the phone's browser. For example, behind HTTPS on a private
   network, with `--public-origin` naming that address. Debug builds also
   accept plain `http://`. Release builds accept HTTPS only.
2. On the host, issue a one-use pairing code for the store. It is 32
   lowercase hex characters and is valid for 10 minutes:

   ```sh
   kb --root <store> --json action-invoke '{"id":"capture.pairCode"}'
   ```

3. In the app, under **Stores**, enter the store's URL and the code, then tap
   **Pair**. The app trades the code for this phone's credential
   (`capture.pair`), which it keeps encrypted with an Android Keystore key.
   The card then shows whether the host accepts this app's capture contract
   version (`Accepts v1 · in step with this phone`). Tap **Open** to load
   the store's kb.

The credential is for capture. The store's page is admitted by the same
rules that admit a browser. A store served with `kb ui --capture-only`
pairs and takes captures, but has no UI to open, so the app shows the queue
for it.

Pairing another store makes that store the one new shares go to. Each queued
capture stays pinned to the store that was current when you shared it, so
switching stores never redirects a pending share. A share made before any
pairing waits and goes to the first store you pair.

## The app

- **Launch** opens the current store's kb. **Back** walks the page's own
  history, then returns to Stores, then leaves the app.
- **Stores** lists the paired stores, with each one's contract status. A
  store whose credential was refused shows as paused until you pair it
  again.
- **Queue** holds what this phone captured:
  - **Pending**: not delivered yet, with the reason once it has tried
    (`Waiting for Personal: timeout`). **Retry now** starts a delivery run.
  - **Sent**: the host committed it. The row shows the node id, and the
    copied bytes have been released.
  - **Failed**: the host refused it for a reason of its own, such as a
    missing inbox or a file that is too large. **Retry** puts it back in the
    queue, and **Discard** drops it.
- **Capture**: a note typed into the queue for the current store. The
  widget, the quick-settings tile and `kb://capture` open it.
- **Links**: `kb://capture`, `kb://queue`, `kb://stores`, and
  `kb://open/<path>`, which opens `<path>` in the current store's kb.

Delivery runs when you share, when you open the app, and in the background
whenever the phone has a network. It retries with exponential backoff from
30 s. A sleeping host or a lost network only delays it.

## How it behaves

| Situation | What the phone does |
| --- | --- |
| Share | Copies the bytes and writes the raw capture into `staging/`. It syncs the files and their directories, renames the capture into `entries/`, and syncs both directories. Only then does it show the toast. A power cut leaves the whole capture or none of it, and a capture that was acknowledged survives. |
| Disk full, unreadable file | Shows `Not queued: …` while the receiver is open, and leaves nothing half-written. |
| A store's UI does not load | Shows the queue in its place, with the store and the reason, and **Try again**. |
| Before each run | Asks the store's `kb.manifest` which `captureContract` versions it accepts. On a mismatch, or when the store names none, the capture stays pending with that reason. |
| Committed | Marks the capture Sent durably and keeps the receipt. Only then does it delete the copied bytes, so a crash never leaves a pending capture without its bytes. |
| `invalid_input`, `not_found`, `conflict`, … | Marks the capture Failed with the host's reason. |
| `unknown_action` | Keeps it pending: this kb has no `capture.submit` yet. |
| `forbidden`, HTTP 401/403 | Pauses the store. Its captures wait until you pair it again. |
| Offline, timeout, 5xx, `internal` | Keeps it pending, counts the attempt, retries later. |

The host is idempotent on `captureId`, so a capture whose answer was lost is
simply sent again.

## What a capture carries

The raw share, as the source app supplied it. The phone maps nothing:

```json
{
  "version": 1,
  "captureId": "1b4e…",
  "capturedAt": "2026-11-19T08:30:00.000+07:00",
  "source": { "app": "com.android.chrome" },
  "text": "https://example.com/article",
  "title": "Article title",
  "files": [{ "name": "IMG_1.jpg", "mime": "image/jpeg", "bytes": "<base64>" }],
  "target": { "store": "<paired store key>" }
}
```

Android supplies a shared link as text (`EXTRA_TEXT`), so it travels as
`text`. The host recognises a text that is a sole HTTP(S) URL and maps it as
a link, with the title as the node's text. It refuses a `target.store` that is
not its own key. The source app is present
only when Android names the referrer.

## Code

| Path | Holds |
| --- | --- |
| `capture/` | The raw capture, its contract version, and the streaming request body writer |
| `storage/` | The `Disk` port and `Durable`, the one crash-durable write path, used by the queue and the pairings |
| `queue/` | The on-device queue |
| `pairing/` | Paired stores and the Keystore-sealed credential |
| `delivery/` | The host client, the delivery decisions, `Notices`, and the WorkManager worker |
| `share/` | The share-sheet receiver |
| `shell/` | The activity and its two WebViews (Capacitor's for the shell's page, `StoreWebView` for a store's UI, with no bridge), `Routes` (which pane shows a URL: launch, links, back, offline), `Shell` (the page's moves over the core) and the `KbShell` plugin |
| `device/` | The widget, the quick-settings tile and the delivery notifications |
| `assets/public/` | The shell's page: Stores, Queue and Capture |

The unit tests (`app/src/test`) run on the JVM, with no emulator. They cover:

- payload building;
- queue durability: restart, a crash before publish, a failed copy, and
  atomic state;
- power cuts before every step, against a disk that models what a crash
  keeps (`CrashDisk`);
- every delivery outcome, and what it notifies, against a scripted host;
- the shell's routing and its page's moves;
- the real activity, Capacitor included, on Robolectric: a store's UI loads
  only in the WebView with no bridge, even where Capacitor falls back to an
  origin-wide interface.

The page's JS is not typechecked or linted, as the rest of the Gradle
project is not gated yet (GAP [[01M7QTAHN8YW57M1R1XYGRBSZ8]]).
