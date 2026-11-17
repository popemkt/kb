# kb routines → Google Calendar: model, sync scheme, operational store and secrets (design, for the owner to read)

## Push reconciles against Google (2026-11-17)

This section supersedes how the Simplified section below decides what to send
and where sync state lives. That covers its in-memory comparison of what was
last sent, its restart that sends everything again, its limit on deletions
made while the worker is stopped, and its status fields on nodes. The
bullets there that it replaces point here.

**Why.** On 2026-11-17 the owner's calendar showed a daily event failed on every
day. The host had restarted. A fresh process remembered nothing it had sent,
so it sent the whole series again, including the one instance ticked done the
day before. That instance was now an exception in Google. The lookup by
original start refused the answer Google gave for it, and the failure was
written on the series, so every day without a fact of its own drew failed.

Underneath was one flaw: what had been sent was known only to the process.
A fingerprint on each node would not fix that, because the writes that most
need a record are for nodes that no longer exist. Taking back Done deletes
the occurrence, yet its day must go back to the series' default in Google.
A deleted event leaves its series in Google. Google itself is the only
lasting record of what kb wrote there, so push reads it from Google.

**Statuses stay on nodes.** Each write's status is written on the node it
is for, as before (Status on nodes, below). Nothing reads a status to decide
what to send: that is decided from the store and Google's list alone.

### Two sides, one pass

- **Desired** is the store now: each event's series (or one-off) and each
  day its facts hold, projected as before (`project`).
- **Acknowledged** is what Google holds of kb's writes. At the start of each
  pass, each kb calendar is listed once with `events.list`, using
  `singleEvents=false`, `showDeleted=true` and `maxResults=2500`, and every
  `nextPageToken` is followed. The list holds each series, each one-off and
  each exception, but none of the instances nobody changed.
- **A pass** compares the two sides per calendar, with a pure function, sends
  only the writes where they differ, and records each write's outcome in the
  host. It runs at startup, after an edit settles (5 seconds quiet, at most
  30), when a retry falls due, and on Sync now. It never runs on a timer of
  its own. One pass costs one paged list call per kb calendar whose sync is
  on, plus the writes it finds.

### What Google holds is compared by digest

Each put stores, in the event's private extended properties,
`kbSent = "<schema>:<SHA-256 of the canonical EventFields>"`. Two predicates
decide everything a pass does with the list. Both live in `@kb/routines`, so
every adapter is judged by the same ones.

- **Whether an event is kb's** (`owned`). An event is kb's when its private
  `kbNode` names a node. An exception is kb's when its series is. The
  adapter decodes kb's fields only from kb's events. A pass compares,
  rewrites or ends kb's events and nothing else. An event a person made in
  kb's calendar, and its exceptions, are left exactly as they are, even
  when one has an id kb would choose.
- **Whether Google holds a write** (`holds`). It checks cancellation before
  any digest:
  - if the remote event is cancelled, it holds the write exactly when the
    write is cancelled too. Google keeps only the ids of a cancelled event,
    so no other part of it can be compared;
  - otherwise, it holds the write exactly when its `kbSent` equals the
    write's digest under the same schema.

  A remote event with no `kbSent` holds no write. That covers one written
  before this change.

**Versioning.** Schema `1` covers today's `EventFields`. A change that adds a
field to `EventFields` adds a schema. The earlier schemas' digests are kept,
and a remote digest is compared under its own schema with the new field at
its default. Adding a field therefore re-sends only the events where that
field holds a value. A schema the reader does not know never matches.

### Identity is derived

Nothing about Google's identities is stored. Each one is derived, from what
Google documents:

- **A series or one-off** has an id kb chooses: a hash of the calendar node's
  and the event node's ids, as before. Google documents that a client may
  choose an event's id when it creates the event: base32hex characters, 5 to
  1024 long, unique within the calendar. kb relies on that, and on a put to
  that id overwriting the event.
- **An exception** has an id kb finds in the list. Google documents that
  `events.list` with `singleEvents=false` returns each exception as its own
  event, carrying `recurringEventId` and `originalStartTime`, which
  "uniquely identifies the instance within the recurring event series even
  if the instance was moved". kb matches an exception to its series and to
  the day its original start falls on in the event's zone.
- **An instance never written** is found with `instances?originalStart`,
  which Google documents as the original start time of the instance to
  return. The lookup reads every page Google hands back. Google documents
  that a page may be short, even empty, while more remain, and that only a
  page token says so. The lookup never runs for an instance the list holds.
- kb never builds an instance id from the series id and a timestamp. Google
  does not document that form.
- **The link** is Google's `htmlLink`, which Google documents as an absolute
  link to the event in its web app. Its form (an `eid` that encodes the
  event and calendar ids) is not documented, so kb does not compute it. The
  link travels with the event's live status, taken from the list or the
  put's response.

### The plan, per kb calendar

- **A series or one-off** is written when it is absent or does not match.
- **A day with a fact** is written to its exception when one exists and does
  not match. With none, the instance was never written, and the lookup finds
  its id.
- **An exception with no fact on its day** goes back to the series' default.
  It is written unless it already matches that default.
- **A series whose event is gone from this calendar** (a series of kb's
  whose `kbNode` names no event on this calendar now: deleted, or moved to
  another calendar) is ended at yesterday in its zone, or cancelled if it is
  a one-off, as before. The pass reads kb's own copy of the series from the
  list, decoded by the adapter, so it needs nothing of the deleted node. A
  series that has already ended is left alone. More than five endings in one
  pass are held until released.
- **Order:** endings first, then each event's series, then its days in order.

### Status lives in the host

The sync worker in the host keeps one status per write target. Each status is
pending, synced or failed with its message, and holds Google's id and link
when it has them. The targets are:

- **an event's series**, keyed by the event node;
- **an instance**, keyed by the event node and the day: a day with a fact, or
  a day going back to its default after its fact was taken back;
- **a calendar**, keyed by its node, for its list call and for the endings
  of series whose events are gone.

How the status moves:

- An edit makes waiting the targets its writes are for. It plans them
  against the last list the worker read; a fresh worker has none, so its
  first pass marks them as it plans.
- A pass sets each write's own outcome. A target whose write is not needed
  is synced. A failed write stops the rest of that event's writes in the
  pass, and those keep the status they had. A failing instance never marks
  its series. Other events go on.
- The first pass after a start recomputes every status from the store and
  Google, with one list call per calendar and, when nothing changed, no
  writes. A restart costs the statuses only the seconds before that pass.

**The contract.** The statuses are a `SyncStatuses` value with four parts:
`series`, `instances`, `calendars`, and `held` (the events whose ending is
held). Two things carry it:

- **`routines.status`**, the family's plugin channel on the page's `/ws`
  socket ([DESIGN.md → Plugin channels](../../DESIGN.md#plugin-channels)).
  A page that sends `{watch: true}` gets the current value at once and then
  each new one, until its connection drops.
- **The `ext.routines.status` action**, which returns the same value to an
  agent or a script. Before the host's first pass has finished, the action
  waits for it, so it never answers from an empty memory.

Sync runs only in a host (`kb ui`), and a one-shot command runs none. The
status action is the host's (DESIGN.md → Plugin channels, hosted actions),
so a one-shot `kb` reaches it only through a running host. With no host it
is not offered at all, and nothing claims an event is synced. That is the
truth when no host runs: nothing is syncing.

The calendar, its failed count, the event editor and the event's preview
read the channel, never node fields. The failed count counts failed writes:
each target in error once, calendars included. A taken-back fact's day is a
target of its own, so it shows waiting and is counted.

The process keeps scheduling too: the settle timer, retries with backoff
capped at ten per event (transport, server and quota failures; others stop
until a change or Sync now), and the releases of held endings. Losing all
of it costs time and a person's repeated release, and it never changes what
is sent.

### Restart, crash and deletion

- After a restart with nothing changed, the pass makes one list call per
  calendar and no writes.
- After a crash partway through a pass, the next pass reads what Google
  got. A series id is derived from its nodes, and an exception is addressed
  by its listed id, so nothing is created twice.
- An event deleted while the host was stopped ends at the next start. This
  closes the Simplified section's limit on deletions made offline.
- A calendar node re-pointed at another Google calendar, or deleted, ends
  kb's series on the Google calendar it named before, as an event moved to
  another calendar node does. The host knows the former calendar from what
  it has seen and from the store's own history: at start it reads the kept
  tail (`graph.changes` from `head − TX_TAIL_KEEP_ENTRIES`, asking each
  write's calendar fields) for every Google calendar a sending calendar node
  named, and after that each change and each pass add to it. A Google
  calendar no node names now is listed in each pass with the binding it was
  named with, and kb's series there are ended, held past five like any
  ending. Once it holds nothing of kb's still running it is dropped, so it
  costs one list call per pass until then. While the calendar node that
  named it is paused or in preview, it is not listed or written: a paused
  calendar makes no write anywhere, its former Google calendars included,
  and their series end once it sends again. A deleted node sends nothing
  now, so its former calendar ends at once. Its status is a calendar status
  keyed by the node and the Google calendar, which the failed count
  includes. The `calendar.app.created` scope cannot list the calendars kb
  made (`calendarList.list` does not accept it), so Google cannot answer
  this alone.
- Two cases stay out of reach (gap `01M7KTB23TP44SDM0D9XY3E5GM`): a
  re-point the host did not see whose write has left the kept tail (more
  than 1,024 transactions committed before the host next starts, or a
  restored or hand-edited store whose tail no longer describes it), and a
  former binding the person no longer trusts, which is not written and
  shows `untrusted` for as long as it is remembered.

### A person's edit in Google

A person's edit to a kb event in Google's own app leaves `kbSent` as it was,
so the pass sees no difference. The edit stays until kb's copy of that event
next changes, and then kb overwrites it, as the Simplified section decided.

Deleting or cancelling a kb event in Google changes its status, which the
comparison does see, so the next pass restores the event.

Push never reads a person's changes into kb. The inbound design
([2026-11-12-gcal-inbound.md](2026-11-12-gcal-inbound.md)) imports only
subscribed calendars and never kb's push calendars (§1). Its conflict rules
are §2's managed fields, §9's deferred two-way sync with `If-Match` on an
etag, and the owner's decisions 4 and 7. They take over if kb's own events
ever accept edits made in Google.

### Operational data the host cannot rebuild

Outbound sync keeps nothing that its next pass cannot rebuild, so it needs no
storage. The Google calendars a calendar node used to name are rebuilt from
the store's kept history (Restart, crash and deletion); one older than that
history is where this directory would help. Inbound will need some: a subscribed calendar's sync token, and the
remote copy the data-plane research placed in an operational store under
`KB_DATA`
([2026-11-10 §6.4](2026-11-10-data-plane-fields-events.md#6-events)). Its
place is a per-family data directory that the platform owns. It sits outside
the graph and is never read as facts. No such directory exists yet, and this
change does not build one.

### The fit with inbound

- Inbound keys an imported event by its calendar and **gcal event id**
  (inbound §2). That id is Google's, read from Google, and it is a fact of
  an event that Google owns. A kb event's id is derived instead, because kb
  owns it.
- The list call is the request inbound's `CalendarSource.events` makes (§7),
  with no token and no window. When G4 builds that port, push lists through
  it.

### Migration

Events pushed before this change have no `kbSent`. The first pass after the
deploy sends each of them once more, to its listed id, with no lookup. That
is safe, because a put overwrites. The alternative, adopting the receipts
stored on nodes as acknowledged without sending, would trust that Google
holds what the store says, and that trust is exactly what failed.

The family migration `routines.sync-off-nodes`, "Take sync state off events",
removes what the store held for sync. It:

- removes the **gcal status**, **gcal message**, **gcal link**,
  **gcal event id** and **synced at** values from every event, occurrence and
  calendar node;
- removes those fields from those three tags' templates;
- deletes the **gcal link** and **gcal event id** field nodes. It does so only
  where no other node holds a value of them; a person's own use keeps the
  field, which is then theirs.

It touches nothing else: no other field, no text and no child, so every value
a person wrote stays. Its check names any event, occurrence or calendar node
still holding one of the five, and any of the three tags still templating one.

A store seeded after this change never has any of it. The account keeps
**gcal status**, **gcal message** and **synced at** for its connection, and a
gap records that (`#gap`).

Sync works before the migration is applied, because nothing reads the old
fields any more: they are only stale text in the outline. On the owner's
store the deploy alone recovers the calendar:

- the restart's first pass sends the series and its 11-16 exception once
  each;
- both read synced on the calendar.

The one step left to the owner is applying the migration in Settings →
Extensions → Migrations, which clears the stale fields.

### The port

`CalendarPort` gains `list(calendar)`. It returns each series, one-off and
exception kb's calendar holds:

- its id and its link;
- for an exception, its series and its original start;
- whether it is cancelled;
- what kb put there, as `EventFields` decoded by the adapter, which owns the
  wire shape both ways, with the `kbSent` digest.

A cancelled event carries neither the fields nor the digest. The shared
contract suite proves these properties over the memory fake and the Google
adapter:

- a put event lists with the fields put and their digest;
- a written instance lists as an exception of its series, with its original
  start;
- a cancelled one lists without content.

The Google adapter's own tests cover paging, both for the list and for the
lookup.

## Simplified (2026-11-04)

This section supersedes the reconciliation, polling, operational-store and
conflict behavior in the original proposal below, following the owner's KB-3
comments on 2026-11-03. kb is the source of truth; Google is its outbound projection.

- One routine projects to one recurring event; sparse done/skipped occurrence
  children project to Google instance exceptions. Google edits are overwritten
  when that routine next pushes. No remote event content is imported.
- Tail kb transactions, settle for 5 seconds quiet with a 30-second maximum,
  and push. IDs derive deterministically from calendar node and routine node IDs.
  The Calendar port has create, idempotent put, a list of what kb's calendar
  holds, and original-start instance lookup (see Push reconciles against Google).
  Every adapter joins the same contract suite. Put owns all projected fields;
  responses return only event ID and htmlLink. No If-Match or merge base exists.
- Superseded (2026-11-17, Push reconciles against Google): sync state no longer
  lives on nodes. The host holds it and serves it on the `routines.status`
  channel, and sync writes nothing to the store.
- Debounce and retries are in-memory scheduling, not a second datastore. Retry
  transport/server/quota failures with backoff, cap at ten, and use Sync now
  for an explicit retry. Authentication/validation failures stop immediately.
  There are no sync tokens, poller, sidecar adapter, lease or recovery probes.
  What was sent is read from Google each pass (see Push reconciles against Google).
- Superseded (2026-11-17, Push reconciles against Google): what was sent is no
  longer compared in memory. Still true: a day whose fact is gone goes back to
  its default, and a move to another calendar ends the previous series before
  publishing its replacement.
- Count the whole pending deletion operation, including destination retirements, before sending any of it. More
  than five routine series are held until explicit release of each one. End series at yesterday in the routine's timezone, retaining history.
- Host only on the trusted shared server. Other copies stay paused/preview.
  There is intentionally no distributed runner coordination. Retry counters
  reset on process restart. Superseded (2026-11-17): startup no longer
  reasserts every projection; it lists Google and sends only what differs.
- Superseded (2026-11-17, Push reconciles against Google): a deletion made while
  the worker is stopped is ended at its next start, from Google's own copy. An
  exception Google drops on a series update is written again by the next pass
  that finds it missing.
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
