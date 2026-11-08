# kb routines → Google Calendar: model, sync scheme, operational store and secrets (design, for the owner to read)

## Simplified (2026-11-04)

This section supersedes the reconciliation, polling, operational-store and
conflict behavior in the original proposal below, following the owner's KB-3
comments on 2026-11-03. kb is the source of truth; Google is its outbound projection.

- One routine projects to one recurring event; sparse done/skipped occurrence
  children project to Google instance exceptions. Google edits are overwritten
  when that routine next pushes. No remote event content is imported.
- Tail kb transactions, settle for 5 seconds quiet with a 30-second maximum,
  and push. IDs derive deterministically from calendar node and routine node IDs.
  The Calendar port has create, idempotent put, and original-start instance lookup.
  Every adapter joins the same contract suite. Put owns all projected fields;
  responses return only event ID and htmlLink. No If-Match or merge base exists.
- State lives on the routine/occurrence node: gcal status (pending/synced/error),
  gcal message, gcal link, gcal event id, synced at. Replace field values only
  when different; no-op syncs do not change timestamps or write transactions.
  The plugin's own writes are excluded by the existing transaction-tail via marker.
- Debounce and retries are in-memory scheduling, not a second datastore. Retry
  transport/server/quota failures with backoff, cap at ten, and use Sync now
  for an explicit retry. Authentication/validation failures stop immediately.
  There are no sync tokens, poller, ledger, sidecar adapter, lease or recovery probes.
- Compare previous and current remote identities while the worker runs. Changing
  an occurrence day or removing its tag restores the retired instance to its
  default projection. Changing a calendar reference or Google calendar ID ends
  the previous series before publishing its replacement.
- Count the whole pending deletion operation, including destination retirements, before sending any of it. More
  than five routine series are held until explicit release of their exact input
  signatures. End series at yesterday in the routine's timezone, retaining history.
- Host only on the trusted shared server. Other copies stay paused/preview.
  There is intentionally no distributed runner coordination. Startup rebuilds
  pending work from nodes and reasserts projections idempotently; already-synced
  nodes retain their timestamp. Retry counters reset on process restart.
- With no durable deletion journal, physical deletions and removed occurrence
  facts are processed while the worker is running. A deletion made while it is
  stopped cannot be recovered from the missing node alone. End the routine via
  its until field before deleting it when offline. Google may retain sparse
  exceptions across parent updates; live acceptance must verify restoration.
- Secrets are references the host placed in its secret store (the macOS
  Keychain, or a file sealed with systemd-creds or AES-256-GCM in kb's data
  directory; DESIGN.md → Writable host secrets), with each person's own Web
  application OAuth client, redirected to kb's own page, and calendar.app.created
  scope. Setup is the page's wizard (DESIGN-UI.md → Sync services), summarized in
  the extension README; the 2026-11-04 dotenv pointers and Desktop loopback
  client are superseded (2026-11-08). Calendar month/week/agenda views are a
  separate pass.

## Scope and ownership

This replaces the original design in [PR #97](https://github.com/popemkt/kb/pull/97),
which remains the historical record. Core time-of-day and writable dotenv-secret
mechanisms are in #98. Extension fields are ordinary field nodes and allowed
values are option nodes; the extension is off by default.

The canonical extension, action, trust and change-tail contracts live in
[DESIGN.md](../../DESIGN.md#core-boundary--extensions). The Calendar port contract
is declared in `packages/extension/routines/src/ports.ts` and proved by
`calendar-contract.ts` against both the memory and Google HTTP adapters. Owner
setup and native action names are in the [extension README](../../packages/extension/routines/README.md).

Supported recurrence is daily/weekly/monthly/yearly RRULEs with bounded UNTIL or
COUNT, timezone-aware starts, and sparse per-day exceptions. Completion-based
recurrence stays deferred. Time defaults to Asia/Ho_Chi_Minh; done instances use
✅ and graphite with no reminders, ordinary events use calendar defaults. Existing
Google events are not imported; the app creates its own calendar for each account.

Validation uses fake Google transports, never credentials or live Calendar calls.
Live OAuth consent, cancelled-instance restoration, exception retention after a
series update, reminders and token revocation require owner acceptance.
