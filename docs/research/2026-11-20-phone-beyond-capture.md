# The phone beyond capture

Research record, 2026-11-20. A design for the owner, based on kb at
`be415b51`. It follows
[`2026-11-18-desktop-and-phone-apps.md`](2026-11-18-desktop-and-phone-apps.md),
which shipped the Android share receiver (`apps/android`).

## Change of direction (2026-11-20): a Capacitor shell around the web UI

The owner does not want a second UI that drifts from the web UI. The phone
app becomes a **Capacitor** shell (Android first) around kb's own web UI,
with native code only for what a device alone can do. Sections 1–4 below
stay as the record of the study. Section 5's native screens are superseded,
and §7 is the design being built.

**Web UI concerns, dropped from the native app.** The web UI already
provides these or would own them. A native copy is the drift the owner
rejected.

| Planned for the phone (§5) | Where it belongs now |
| --- | --- |
| Today: where captures land, and its children | The web UI's landing (days' today, the `ui.landing` role) |
| Node page with tags, fields, children, breadcrumbs | The web UI's node page |
| Search | The web UI's search and ⌘K |
| Inbox browsing: opening the node a capture became | The web UI, opened at the receipt's node id |
| A tag picker inside the app | The web UI's own capture, which already tags |
| Offline copies of read screens | The web UI's concern, if it is ever offline-capable; not a native cache |
| `capture.place` and the `read` device scope, which feed native read screens | Dropped. The web UI reads through its own channel. |

**Device concerns, kept native.** These need the operating system, or
have to work when no page is open.

| Device feature | Why it is native |
| --- | --- |
| Share-sheet receiver and the durable capture queue (exists) | The share intent and the crash-durable copy happen before any page loads. They deliver even if the web UI is unreachable. |
| Pairing, and the Keystore-sealed device credential (exists) | A secret kept by the OS, used by the background worker |
| Contract-version check and background delivery with retry (exists) | Runs in WorkManager when no app is open |
| Home-screen widget and quick-settings tile for one-tap capture | OS surfaces, feeding the same queue |
| Notifications when delivery fails or a store pauses this phone | Only the background worker knows, and nothing is open to show it |
| Voice memo recording, delivered as an audio file capture | Microphone and recording run in the OS. Transcription stays on the host and is optional. |
| Android back button, and `kb://` deep links | OS input mapped onto the web UI's own navigation |

**Parked code.** The host half of contract v2 was written, and its focused
tests passed before it was set aside. It covered scopes chosen at
`capture.pairCode`, a `read` scope, `tags` on `capture.submit`,
`capture.place` and `captureContract: [1, 2]`. It is not committed: with no
consumer it would be a dead seam. It is kept as
`host-capture-v2-scopes.patch` in the storage of the thread that wrote it.
`tags` come back if the share sheet ever gets a tag picker, which would also
need a tag list on the phone.

## Decisions for the owner

| Decision | Recommendation |
| --- | --- |
| Does pairing also gate the web UI? | Not yet. The shell loads the same page a phone browser does, so what admits the browser admits the shell. Pairing yields the capture credential. If the UI itself should need a paired device, the next step is a credential the page listener accepts: a `ui` scope chosen at `capture.pairCode`, which would bring back the parked scopes (§3). |
| May the phone write beyond capture? | Through the web UI, as any browser can. Natively, only capture. |
| Voice memos | Deferred. Recording stays a capture of an audio file, and transcription stays on the host and optional. |
| Push notifications | Local only for now, posted by the delivery worker. Push from the host through a self-hosted service (ntfy, UnifiedPush) is a gap. |

Sections 1–6 record the study that came before the decision. Section 7 is
the shell being built.

## 1. What Tana's phone app does

Tana's mobile app (iOS first, with Android catching up) has five tabs, read
from Tana's own feature pages on 2026-11-20:

- **Browse**: the home node, a **Today** shortcut to the day's page, and
  pinned nodes, with breadcrumbs, back, and expand and collapse.
- **Supertags**: the tag list, filterable and pinnable, with a voice button
  per tag.
- **Capture**: write, voice, camera, media and files. A capture goes to
  Today, Tomorrow, Inbox or a pinned node, and long-pressing one makes it the
  default. A supertag picker shows the tag's fields while you capture.
- **Search**: across workspaces, with recent searches. Complex queries
  need the whole graph and do not run on mobile.
- **Manage**: account, plan and settings.

Voice memos are transcribed on Tana's servers. With a supertag, AI fills the
title and the fields, and the audio stays attached to the note. There are
home-screen capture widgets on both platforms, and on iOS also lock-screen
widgets, a Control Center control, Siri and Shortcuts. Editing is full
outliner editing, behind an early-access flag in some versions. Login is a
Tana account. The pages do not describe the share sheet, offline behaviour
or notifications.

Three things make Tana mobile more than a capture box:

1. **Today is home.** You open the app and see the day you are capturing
   into.
2. **The tag is chosen at capture**, so a capture arrives already shaped.
3. **Capture is everywhere**: widget, control, share sheet, voice.

Browsing and search let you check what is already there before you add
more. Editing is the least used part on a phone.

## 2. What kb can expose

Everything the phone would show already exists on the host as a registry
read:

| Phone need | Host read | Note |
| --- | --- | --- |
| Where captures land (Today, with Days on) | the capture target role ([DESIGN.md → Provider roles](../../DESIGN.md#provider-roles)) | Planned over the store and not committed: **`capture.place`** (new, read). |
| A node and its children | `node.get` `{id, depth}` | Raw props keyed by field id. Names come from one query. |
| Names of tags and fields | `graph.query` | One query for a set of ids, and one for every tag (the picker). |
| Search | `graph.search` `{text, limit}` | `[id, title]` rows. |
| Recent captures | the phone's own queue | Each sent capture keeps its receipt's node id. Nothing new is needed on the host. |

Days stays a family the phone knows nothing about. The phone asks "where
does a capture land now?", and with Days on and `captures: today` the host
answers today's node. With Days off it answers the top level, and an inbox
family that claims the role would answer its inbox. So the phone's home is
always where its captures go, which is the reason to look at it.

## 3. Security model: scoped device credentials

Today a paired credential admits exactly `capture.submit` and discovery. The
change keeps the shape of that model and makes its one implicit scope
explicit:

- **The owner chooses scopes when issuing the code.** `capture.pairCode`
  takes `{scopes?}`, each one of `capture` or `read`, and the default is
  `["capture"]`. Only the host CLI can issue codes, as before, so the person
  who holds the store decides what a phone may do. The phone cannot ask for
  more.
- **Scopes are recorded per device**, on the device's node under
  `sys.capture.devices`, as values of `sys.f.capture.scope`. A device node
  paired before scopes existed has no value, and it reads as `["capture"]`.
  So every existing phone keeps exactly what it had.
- **The listener enforces them.** The capture wire (a `--capture-only`
  listener, or any `Bearer kbcap_…` call) admits `kb.manifest` and
  `capture.pair` as before, and any other call only when the device's
  scopes admit that action. One table, `CAPTURE_SCOPE_ACTIONS`, owns which
  actions each scope admits:
  - `capture` admits `capture.submit`;
  - `read` admits `capture.place` and the graph reads, the list a sandbox
    `graph` grant covers (`GRAPH_READ_ACTIONS` in `@kb/sandbox`). The two
    meanings of "reads the whole graph" share that one list rather than
    keeping two copies.
- **Revocable, and never widened in place.** `capture.revoke {deviceId}`
  removes the credential as before. To change a phone's scopes, revoke it
  and pair again with a new code. A scope never grows silently.
- **The phone learns its scopes from the host.** `capture.pair` returns
  them, and discovery (`kb.manifest` on the capture wire) returns the
  calling device's scopes each time. The phone never caches a grant that the
  host has since revoked.

`read` is a real widening. A phone with `read` can read every node in the
store, including system nodes, and a stolen phone with an unlocked
credential can too, until the owner revokes it. The credential is sealed by
the Android Keystore at rest, as before. A `graph.query` from the phone is
bounded in its result but not in its cost
(GAP [[01M41DKVSGG1R5A27Q49SBPHDD]]), which is acceptable for the owner's
own device.

## 4. Contract v2

`captureContract` becomes a list of versions: the host advertises
`[1, 2]`. A v1 phone already reads a list (`CaptureHost.acceptedContracts`)
and keeps sending v1. The desktop sends v1 and never reads the version.
Version 2 adds:

- `capture.submit`: `version: 2` may carry `tags`, tag node ids applied to
  the capture's root node when the host files it. The host refuses an id
  that is not a tag, and refuses `tags` on a v1 capture. Tags are part of
  the capture's identity, so a retry with different tags is a conflict like
  any other change.
- `capture.pairCode {scopes?}` → `{code, expiresAt, deviceId, scopes}`.
- `capture.pair` → `{token, deviceId, store, captureContract: [1, 2],
  scopes}`.
- Discovery on the capture wire → `{captureContract: [1, 2], scopes?}`.
- `capture.place` (read, `read` scope) → `{at: "top"}`,
  `{at: "node", id, text}`, or `{at: "new", text}`. The last means the
  capture target would make the node with the next capture, for example
  today's day before anything has landed in it.

The phone encodes each capture in the lowest version that carries it: v1
unless it has tags. An older host therefore still takes untagged captures
from a new phone.

## 5. The first useful version

Chosen by value per unit of work, using only the reads above:

1. **Today**: the app opens on where captures land, which is the day's
   node with Days on. It shows its children, each with its tags, and you
   can tap one to open it. When nothing has landed yet, it says so and
   names the day.
2. **Node page**: the node's text, tags as chips, its user fields, and its
   children, with breadcrumbs back up the stack. **Add here** queues a
   capture whose `target.parent` is this node. That is v1 capture, already
   allowed.
3. **Search**: `graph.search` as you type, and a result opens its node page.
4. **Inbox**: the existing queue (pending, sent, failed). A sent row opens
   the node it became.
5. **Capture sheet with a tag picker**: text, optional tags from the
   store's tag list, and the destination shown ("Today", or the node it was
   opened from).
6. **One-tap capture**: a quick-settings tile and a home-screen widget open
   the capture sheet straight away.
7. **Offline**: each read answer is kept on the phone (`off-graph:
   device-local`). With the host out of reach, a screen shows its last
   answer and says how old it is. Captures already queue offline.
8. **Delivery notifications**: a capture that the host refuses, or a store
   that refuses this phone, posts a notification. You no longer find out
   only when you next open the app.

The phone still makes no graph writes of its own: every write is a
`capture.submit` that the host maps and files.

## 6. Deferred, as gaps

- **Write scopes beyond capture**: edit text, tick a todo, set a field, move
  a node. Each would be a named scope (`edit`) granted at pairing and owner
  approved. The open question is whether a phone edit carries a person's
  approval, which today the capture wire conveys none of
  (GAP [[01M413SP3QSSQJMKKDK3W3J6G8]]).
- **Field values at capture**: the picker applies tags only. A tag's
  template fields would need typed inputs on the phone and validation on the
  host.
- **Voice memos**: record audio and capture it as a file. The host's asset
  rules must admit the audio format. Transcription is a host-side optional
  enrichment, never the phone's.
- **Images and assets on the phone**: assets are served by `GET` routes that
  the capture listener refuses. Admitting them under `read` is a small,
  separate change.
- **A subtree-scoped `read`**: a credential that sees one node and what is
  under it, as a sandbox `subject` grant does.
- **Device management from an authenticated host surface**
  (GAP [[01M7QT8Z33KEHWZ5KNQXRWGYZ4]]): listing devices and their scopes.

## 7. The Capacitor shell

### The UI comes from the store

The shell bundles no kb UI. A paired store is its **UI URL**, the page a
browser opens, and the WebView loads that URL. The UI is therefore always
the store's own kb version: it cannot drift from the web, and cannot drift
from the server, because it is the same page served by the same process.
UI changes ship with the store's kb and need no over-the-air mechanism. Only
a change to the shell or its plugins needs a new APK.

The store page runs as it does in a phone browser. Capacitor injects its JS
bridge only into the app's own origin: a document-start script for one
origin, `https://localhost`, through `WebViewCompat`. The store's page
therefore has **no native access**, and the token stays out of its reach.
Whatever admits a phone browser to that page admits the shell: the same
listener, origins and identity rules. One URL serves both halves. The page
is at `<url>/`, and capture delivery and pairing go to `<url>/api/action`.
A `Bearer kbcap_…` call is already the capture wire on any `kb ui` listener
(`requestGuard`), and so is an unauthenticated `capture.pair`. A
`--capture-only` listener remains an option for a store that exposes
capture alone. Its URL pairs and delivers, and the shell then shows the
offline screen in place of a UI.

### What the shell owns

One small page bundled with the APK, `https://localhost/`, styled by kb's
own `design-system.css`. Gradle copies that file from `packages/app/ui` at
build time, so the shell keeps no copy of kb's colours. The page has three
views:

- **Stores**: the paired stores, plus Add (UI URL and one-use code →
  `capture.pair`, credential sealed by the Android Keystore), Open, Forget.
  Pairing stays the only access model. Nothing in the shell knows about
  Tailscale or any other network.
- **Queue**: the phone's captures (pending, sent, failed), with retry or
  discard on each; its tab carries the count still waiting. It is also the
  offline screen: when the store's UI does not load, the shell shows it in
  place of the broken page, headed "Offline — <store> did not load", with
  why, "captures are queued (N)" and Try again.
- **Capture**: a text field and Queue. The widget, the tile and `kb://capture`
  open it. It writes to the same durable queue as the share sheet.

The page reaches the Kotlin core through one Capacitor plugin, `KbShell`:
stores, pair, forget, open, queue, enqueue, retry, discard. The capture
core itself is unchanged: the durable file queue with directory fsync,
WorkManager delivery, share-sheet intake and receipts, with its JVM tests.

### Device features

| Feature | Shape |
| --- | --- |
| Share sheet | Unchanged: `ShareActivity` copies into the queue and toasts. It works offline and without a UI. |
| Widget, quick-settings tile | Each opens the Capture view. |
| Notifications | After a delivery run, one notification per capture that became Failed and per store that paused this phone. They are local, posted by the worker. Push from a self-hosted service (ntfy, UnifiedPush) for host-side events is GAP [[01M7WZ0QV3HAB6YRKS8CHE1793]]. |
| Back button | WebView history first, then from a store's UI back to Stores, then exit. |
| `kb://` deep links | `kb://capture` opens Capture, and `kb://open/<path>` opens `<path>` in the current store's UI. The path is the web UI's own route, so the shell keeps no route table of its own. |
| Voice | Deferred, GAP [[01M7WZ0Q5ZJ2NZ36T3JNWXJNVE]]: record audio and queue it as a file capture. The host's asset rules must admit the format. |

### How it builds

The build uses Gradle only, in `nix develop .#android`, with no npm and no
Capacitor CLI. Capacitor's Android runtime is the Maven artifact
`com.capacitorjs:core`, which ships `native-bridge.js`. The shell page is
static HTML and JS under `app/src/main/assets/public`, beside the
`capacitor.config.json` Capacitor reads. `cap sync` exists to copy a web
build and wire npm plugins, and the shell has neither.
