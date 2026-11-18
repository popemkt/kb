# kb capture for Android

A thin share receiver for kb. Pick **kb** in any app's share sheet, and the
share (text, a link, one or more images) is copied into a queue on the phone
straight away. The toast says `Queued · <store>`, and you are back in the app
you came from. A background worker then delivers each capture, unchanged, to
the paired store's `capture.submit` action. The store decides what nodes the
capture becomes and where they go.

The design is
[`docs/research/2026-11-18-desktop-and-phone-apps.md`](../../docs/research/2026-11-18-desktop-and-phone-apps.md)
§3–4. The wire contract is the host's `capture.submit` and `capture.pair`
(`DESIGN.md` → Action registry).

This is a first version, for a local trial on one phone.

## Build

Everything comes from the repository's flake, so nothing is installed on the
host. The `android` dev shell brings a JDK, Gradle and an Android SDK (platform
36, build-tools 35), with the SDK licence accepted for that shell only. It is
defined for `x86_64-linux` and `aarch64-darwin`.

```sh
nix develop .#android -c gradle -p apps/android assembleDebug
# → apps/android/app/build/outputs/apk/debug/app-debug.apk
nix develop .#android -c gradle -p apps/android testDebugUnitTest
```

The debug APK is signed with the SDK's generated debug key, which is enough for
`adb install`. Nothing here signs with anyone's account or publishes to a
store. The Gradle project is not part of the Bun workspace (`packages/*/*`):
`bun install`, `bun run verify` and Nx do not see it.

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

The phone sends to a store's `kb ui` server over your tailnet. Set that up
once, on the machine that hosts the store:

1. Serve the store and make it reachable from the phone over HTTPS. A
   capture-only listener admits just what the phone needs: version discovery,
   pairing, and capture with a bearer token.

   ```sh
   kb --root <store> ui --capture-only --no-open --port 4322
   tailscale serve --bg 4322      # https://<machine>.<tailnet>.ts.net
   ```

   Debug builds can also use plain `http://` (for example
   `http://100.x.y.z:4322`). Tailnet traffic is already encrypted by
   WireGuard. Release builds accept HTTPS only.
2. On the host, issue a one-use pairing code for the store. It is 32
   lowercase hex characters and is valid for 10 minutes:

   ```sh
   kb --root <store> --json action-invoke '{"id":"capture.pairCode"}'
   ```

3. In the app, under **Stores**, enter the store URL and the code, then tap
   **Pair**. The app trades the code for this phone's credential
   (`capture.pair`), which it keeps encrypted with an Android Keystore key.
   The card then shows whether the host accepts this app's capture contract
   version (`Accepts v1 · in step with this phone`).

Pairing another store makes that store the one new shares go to. Each queued
capture stays pinned to the store that was current when you shared it, so
switching stores never redirects a pending share. A share made before any
pairing waits and goes to the first store you pair.

## The app screen

- **Stores**: the paired stores, with each one's contract status. A store
  whose credential was refused shows as paused until you pair it again.
- **Capture field**: type a note and tap **Queue**. It takes the same path as
  a share.
- **Pending / Sent / Failed**:
  - **Pending**: not delivered yet, with the reason once it has tried
    (`Waiting for Personal: timeout`,
    `Personal accepts v2. This capture uses v1.`). **Retry now** starts a
    delivery run.
  - **Sent**: the host committed it. The row shows the node id, and the
    copied bytes have been released.
  - **Failed**: the host refused it for a reason of its own, such as a
    missing inbox or a file that is too large. **Retry** puts it back in the
    queue, and **Discard** drops it.

Delivery runs when you share, when you open the app, and in the background
whenever the phone has a network. It retries with exponential backoff from
30 s. A sleeping host or a disconnected tailnet just delays delivery.

## How it behaves

| Situation | What the phone does |
| --- | --- |
| Share | Copies the bytes and writes the raw capture into `staging/`. It syncs the files and their directories, renames the capture into `entries/`, and syncs both directories. Only then does it show the toast. A power cut leaves the whole capture or none of it, and a capture that was acknowledged survives. |
| Disk full, unreadable file | Shows `Not queued: …` while the receiver is open, and leaves nothing half-written. |
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
| `delivery/` | The host client, the delivery decisions and the WorkManager worker |
| `share/` | The share-sheet receiver |
| `ui/` | The Compose screen in kb's dark palette |

The unit tests (`app/src/test`) cover payload building, queue durability
(restart, a crash before publish, a failed copy, atomic state), power cuts
before every step against a disk that models what a crash keeps
(`CrashDisk`), and every
delivery outcome against a scripted host. They run on the JVM, with no
emulator.
