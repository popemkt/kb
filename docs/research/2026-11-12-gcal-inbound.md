# Inbound Google Calendar: your calendars, as events in kb

Status: **design, for the owner.** Nothing here changes code. This record
designs importing events from the Google calendars a person chooses into
kb. Today the events family (`routines`, labelled Events) only pushes kb
events out to a Google calendar that kb creates
(`packages/extension/routines-gcal/src/client.ts`;
[the routines design](2026-11-02-kb-routines-gcal.md)).

Date: 2026-11-12.
Inputs:
- kb `main` at `0caabcc0`;
- the events model and its planned restructure
  ([data-plane design §6](2026-11-10-data-plane-fields-events.md#6-events),
  E1 merged as kb#159 and kb#161; E2 and E3 not built);
- the jobs mechanism and the store-is-the-truth rule in the CLI and host
  modes record (kb#189, §6–§7, not yet on `main`);
- Google's Calendar API v3 reference and its sync, recurring-events, auth
  and push guides, read on 2026-11-12. Facts the guides do not state are
  marked as live acceptance.

## 0. The answer in one screen

**Google owns the event's facts; kb owns your thoughts about it.**

| Piece | Design |
|---|---|
| What an event becomes | one `#event` node per Google event, under the subscribed calendar's node, keyed by (calendar, Google event id) |
| Google's facts | title (the node's text), start, time, duration, time zone, recurrence, status, attendees, meeting link, location, description. These are fields managed by the events family: a person may edit them deliberately, and the import rewrites them when Google next changes the event |
| Your thoughts | children, tags (your `#meeting`), your own fields, links, and an instance's done state. The import never touches them |
| Cancellation | `event status = cancelled` on the node. It is never deleted |
| Recurrence | one node per series, holding Google's recurrence lines verbatim in `repeat`. Only an exception (a moved, changed or cancelled instance) becomes an `#occurrence` child. Nothing else is expanded into nodes |
| Sync state | the sync token is a managed field on the calendar node, in the store |
| No echo | kb's own push calendars cannot be subscribed, and events kb pushed are skipped |
| Running it | `ext.routines.import`, a job (kb#189 §6): every 10 minutes from any runner, or one-shot |
| Two-way | deferred, and recorded as a `#gap` |

**This supersedes part of the 2026-11-10 data-plane design.** That design
decided (D8; §6.4; build step E4) that a subscribed calendar's events live
in a sync cache under `KB_DATA`, are seen by queries as virtual nodes, and
become nodes only when annotated ("copy on write"). This record replaces
that with nodes for every imported event. The reasons:

- **The store is the truth** (kb#189). A per-machine cache is truth that
  lives outside the store. Other machines see virtual events only where a
  cache exists, and the cache would be the first feature-specific storage
  under `KB_DATA`. kb#189 §9 records that as a gap the owner wants to keep
  open, not widen.
- **One shape.** A virtual node, a materialize step and a cache are three
  mechanisms for one concept. Nodes need none of them: an annotation is
  just a child, and queries, backlinks and the day page see imported events
  as they see any event.
- **The cost is store growth** (§8). It is bounded by an import window and
  by series collapsing to one node.

D9 (Google wins on its own fields, with no push-back) stands, and so does
§6.6's field table, apart from what §2 changes. Decision 1 asks the owner to
confirm the supersession.

## 1. Calendars: which ones, and what keeps kb's own out

A calendar node (`#calendar`, `sys.tag.calendar`) gains `source` (§6.6:
`kb` pushes, `google` is subscribed). A subscribed calendar node holds:

| Field | Type | Who writes it |
|---|---|---|
| `source` | ref, closed: `kb` · `google` | set when the calendar is added |
| `account` | ref → `#google-account` | existing |
| `calendar id` | text | existing; Google's calendar id |
| `sync` | `preview` · `on` · `paused` | existing; `preview` runs the import without writing |
| `import from` *(new)* | date | the person; default 90 days before the first import |
| `gcal sync token` *(new)* | text, hidden, managed | the import |
| `gcal message` | text | existing; the last error or resync note |

**No echo, two ways.**

- **The picker.** It lists the person's calendars
  (`calendarList.list`) minus every Google calendar id held by a
  `source = kb` calendar node. A commit guard refuses a `google` calendar
  whose id a `kb` calendar holds, so an agent or a hand edit cannot
  subscribe one either.
- **The events.** An event whose `extendedProperties.private` carries
  `kbNode` or `kbRunner`, which kb's push writes (`wire.ts`), is skipped. It
  would be one of kb's own events seen through another calendar, for
  example a shared copy.

**Scopes.** The account's OAuth grant adds two scopes by incremental
authorization, to the same client the person already set up:
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, to pick
  calendars;
- `https://www.googleapis.com/auth/calendar.events.readonly`, to read
  events.

`calendar.app.created` stays, for push. `calendar.readonly` would cover both
new scopes in one string, but it is wider ("see and download any calendar").
The setup wizard (DESIGN-UI.md → Sync services) gains the consent step and
the picker. Both are steps of the procedures primitive, so the picker does
not grow the wizard's own walker (gap `01M74NN86YC7HP65R2JVYMM27F`).

## 2. An event, as a node

Each Google event is one node, filed under its calendar node. A node is
found by its key, (calendar node, `gcal event id`). A commit guard keeps
that key on one node, as days' `unique-key.ts` keeps a period key on one.

| Field | Google source | Owner |
|---|---|---|
| node text | `summary` | Google (managed) |
| `starts`, `at` | `start`, as a local date and time in `timezone`; `at` is empty for all-day | Google |
| `duration` | `end − start` in minutes; for all-day, days × 1440 (§4) | Google |
| `timezone` | `start.timeZone`, else the calendar's time zone | Google |
| `repeat` | `recurrence`, verbatim, one line per entry (§3) | Google |
| `calendar` | the subscribed calendar node | Google |
| `gcal event id` | `id` | Google; the key |
| `event status` *(new, §6.6)* | `status`: `confirmed` · `tentative` · `cancelled` | Google |
| `gcal link` | `htmlLink` | Google |
| `attendees` *(new, §6.6)* | `attendees[].email` | Google |
| `meeting link` *(new, §6.6)* | `hangoutLink`, else the first video entry point in `conferenceData` | Google |
| `location`, `description` *(new)* | `location`, `description` | Google |
| tags, children, your fields, links | — | **you** |
| `state` on an occurrence (`done`) | — | **you** |

Two fields of §6.6 are dropped:

- `gcal original start`: an occurrence's `on` and `on at` already are
  Google's `originalStartTime`, so a second field would be a mirror;
- `gcal etag`: push-back is deferred (§9).

**Managed, not locked.** Every Google-owned field above declares
`sys.f.managedBy` → the events family, as days' period key does
([AGENTS.md → Data-plane freedom](../../AGENTS.md#data-plane-freedom)).

- The page puts its one deliberate step in front of a person's write. The
  import writes these fields with `via: "ext.routines.import"`.
- A person's edit is allowed, and stays until Google next changes that
  event. The next delta then rewrites every Google-owned field from Google's
  copy. A person who wants their own title for a meeting writes it on a
  child or in their own field, which is theirs.
- The one value that no constraint can check is `gcal event id`. A wrong
  id orphans the node or makes it collide. AGENTS.md says such a value is
  the kind to lock. Until gap `01M74AS94FM8GDGF3W10M84P43` (the managed
  field lock) closes, the unique-key guard is the protection: a write that
  makes two nodes hold one key is refused.

**Deleting an imported node** is the person's right. The import treats a
missing node as "not imported yet", so the node comes back when Google next
reports the event (a change, or a resync). Decision 8 asks whether a
dismissed event should stay away.

## 3. Recurring events

### 3.1 What Google sends

The import lists with `singleEvents=false`, so Google returns a series as
one event, never as its instances:

- **A series master** has `recurrence`, which holds RRULE, EXRULE, RDATE and
  EXDATE lines but never DTSTART. Its `start.timeZone` is required: "the
  time zone in which the recurrence is expanded".
- **An exception** is an instance that was moved, changed or cancelled. It
  is its own event, with `recurringEventId` (the master's id) and
  `originalStartTime`, which "uniquely identifies the instance within the
  recurring event series even if the instance was moved".
- **A cancelled exception** has `status = cancelled`. It is "only
  guaranteed to have values for the id, recurringEventId and
  originalStartTime".
- With `singleEvents=false` and `showDeleted=false`, "cancelled instances of
  recurring events (but not the underlying recurring event) will still be
  included". An incremental list with a sync token always includes
  deletions.

### 3.2 How a series maps onto kb's model

kb's model (data-plane design §6.1–§6.3) is that an event with a `repeat` is
a series, and an instance is virtual until someone writes to it. A written
instance is an `#occurrence` child keyed by its original start (`on`, and
`on at` from E2). Google's model is the same, with one change of words: a
Google exception is a kb occurrence.

| Google | kb |
|---|---|
| single event | `#event`, `repeat` empty |
| series master | `#event` whose `repeat` holds the `recurrence` lines |
| an instance nobody changed | nothing: the calendar and the day page expand it from `repeat` |
| exception: moved | `#occurrence` under the series, key `on`/`on at` = `originalStartTime` in the series' `timezone`; `moved to`/`at` = its new start |
| exception: changed text, length or attendees | the same `#occurrence`; its own text and `duration`, and its Google-owned fields |
| exception: cancelled | the same `#occurrence`, `event status = cancelled` |
| series deleted | the series node's `event status = cancelled`; its occurrences and children stay |

Every occurrence the import writes also carries the exception's
`gcal event id`. It inherits the series' tags (D6), so an instance of your
`#meeting` series is a `#meeting`.

**Google's facts and yours stay on separate fields.**

- Cancellation goes to `event status`, never to `state`. `state` is kb's
  field: a person ticks a Google meeting done, which is a thought about it,
  not a fact Google holds.
- A move is `moved to`/`at` without `state = moved`. E2 makes `state`
  optional, and the reader already places an instance by its `moved to`
  whenever it is set (`instancePlace`).

So a person may tick a moved instance done, and the next import still owns
where it is.

**An occurrence that you wrote first.** You write notes on an instance that
Google has never changed, and E2's one materialize function makes the
`#occurrence`, with no `gcal event id`. If Google later makes that instance
an exception, the import finds the occurrence by its key (`on`, `on at`).
It adds the exception's id and facts to that node, so there is never a
second node, and your children stay as they are.

**Ordering within a run.** A delta does not promise that a master comes
before its exceptions. The import applies masters and single events first,
then exceptions. An exception whose master is outside the import window
(§5.1) is skipped with it. An exception whose master is not in the store
for any other reason is written as a one-off `#event` holding its own
facts, with `gcal message` saying its series is missing. A later run moves
it under the series if the master arrives.

### 3.3 Rules kb can and cannot say

kb's push engine accepts one RRULE with FREQ `DAILY` to `YEARLY`, INTERVAL,
BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS, COUNT and UNTIL (`canonicalRule` in
`routines/src/projection.ts`). Google can send more: EXDATE and RDATE
lines, EXRULE, several RRULEs, BYHOUR, BYWEEKNO, WKST.

- **`repeat` always holds Google's lines verbatim.** There is one carrier,
  not a "kb rule" field beside a "raw rule" field.
- **Expansion reads the whole set.** The family's one expansion reader
  (`seriesDays`/`calendarEntries`) moves from `RRule` to rrule's own
  `rrulestr(…, {forceset: true})` (`RRuleSet`, in the pinned rrule 2.8.1).
  It takes DTSTART from `starts` + `at` with `TZID = timezone`. A
  single-RRULE `repeat`, which is every kb-made event, expands exactly as
  today, so the reader gains no branch by source.
- **The editor names what it can.** The repeat picker names a rule it can
  say ("every week on Mon, Wed"). Anything else shows as its lines, read
  only, because Google owns it.
- **The push guard keeps its meaning.** "A rule the engine can send"
  guards `repeat` on events whose calendar pushes (`source = kb`), which is
  where it matters. On a subscribed calendar there is nothing to send.

### 3.4 When an instance or a series is edited in Google

| Edit in Google | What arrives | What kb does |
|---|---|---|
| one instance moved or retitled | an exception | upserts the occurrence (§3.2) |
| one instance deleted | a cancelled exception | occurrence `event status = cancelled` |
| the whole series retitled or given new attendees | the master | rewrites the series node's Google-owned fields; occurrences keep their own |
| the whole series moved to another time of day | the master, with a new `start` | rewrites `starts`/`at`. Occurrences you made (no `gcal event id`) are keyed by the old time, so the same transaction shifts their `on at` by the same amount, and your notes stay on "the same meeting". Google's exceptions arrive with their own `originalStartTime` |
| "this and following" | not documented by Google. Observed behaviour, to be confirmed in live acceptance: the old master gains an UNTIL, and a new master with a new id starts at the split | the old series node's `repeat` updates and a new series node is made. Occurrences under the old node after the split stay where they are. The import never moves your nodes; the calendar shows them as "outside its series" (decision 5) |
| the series deleted | a cancelled master | `event status = cancelled` on the series |

## 4. Time zones and all-day events

- **Timed events.** `start.dateTime` carries an offset. kb stores the local
  date and time in `timezone`, which is `start.timeZone` when Google gives
  one and the calendar's time zone otherwise, so every node says its own
  zone. `duration` is the difference between the two instants, so an event
  whose end is in another zone (a flight) keeps its length. Its end is
  shown in the start's zone, since a kb event has one zone.
- **Series.** They expand in `timezone`, with DST handled by the expansion,
  as the push projection already handles it. Exceptions' `originalStartTime`
  values are converted into the series' zone before they become `on` and
  `on at`.
- **All-day events.** `start.date` and `end.date` mark them, and the end is
  exclusive. `at` is empty. A one-day event has `duration` empty or 1440.
  A longer one has days × 1440. **The model needs one reader change here:**
  today `span` always draws an all-day event as one day, whatever its
  duration (`projection.ts`). The reader learns to honour a whole-day
  duration, and kb-made all-day events get multi-day events for free (§10,
  step G2).
- **All-day series.** Exceptions' `originalStartTime` is a `date`, so `on at`
  stays empty.

## 5. Sync

### 5.1 The first import

1. `events.list(calendarId, singleEvents=false, showDeleted=false,
   maxResults=2500)`, page by page. There is no `timeMin`: a sync token
   cannot be combined with `timeMin`, and "all other query parameters should
   be the same as for the initial synchronization". Google's own sample sets
   `timeMin` on a full sync, but what a windowed token then returns is not
   documented, so the import does not depend on it.
2. **The import window is applied by kb.** A single event, or a series whose
   last instance ends before `import from`, is skipped, together with its
   exceptions. A series that runs past `import from` is kept whole. The rule
   is a pure function of the event, so a later delta about an old event is
   skipped by the same rule.
3. **Writes go in bounded transactions** (500 nodes each), as idempotent
   upserts by key. The sync token is written only in the last transaction.
   A run that dies partway leaves no token, so the next run starts the full
   list again, and the upserts converge.

### 5.2 Incremental runs

`events.list(syncToken, singleEvents=false, maxResults=2500)`, page by page.

- Deletions are always in the delta. The import applies it (§3.2–§3.4) and
  writes the new token with the last page's writes.
- **No-op runs commit nothing.** Whether `nextSyncToken` changes when
  nothing changed is not documented. The import writes a new token only
  when the delta changed something, or when the stored token is more than a
  day old. A quiet calendar therefore costs at most one small commit a day,
  and the token never gets older than a day. To be confirmed in live
  acceptance.

### 5.3 410 Gone

"The sync token has been invalidated by the server": it expired, or the
calendar's ACLs changed. The client must "clear its storage and perform a
full synchronization".

In kb, clearing storage never means deleting nodes:

1. The import drops the token and lists everything again, as in §5.1.
2. It upserts every event, and the import window applies.
3. It reconciles: every node of that calendar holding a `gcal event id`
   that the full list did not contain gets `event status = cancelled` and a
   `gcal message` saying "not in Google at resync, <date>". Your nodes,
   their children and their tags stay.
4. It writes the new token.

### 5.4 Cancellation and restoration

- A cancelled event or series only sets `event status`. The other Google
  facts are left as they were, because a cancelled event "is only
  guaranteed to" carry its ids.
- An event restored in Google (undeleted) returns with `confirmed`, and
  the import sets it back.
- Unsubscribing a calendar sets its `sync` to paused and keeps every node.

## 6. The import as a job

Under kb#189 §6, the import is an action marked `job: true`:
`ext.routines.import {}`.

- It runs every `source = google` calendar whose `sync` is `on`, and in
  `preview` mode reports what it would write.
- The events family seeds its `#job` node with `runs =
  ext.routines.import` and `every = PT10M`. `runs on` is set to the machine
  that connected the account, and the person may change any of these.
- Any runner may run it: the host's scheduler, `kb jobs run --due` from
  cron, or one call
  (`kb action-invoke '{"id":"ext.routines.import","input":{}}'`). With the sync token, the
  window and the import's state all in the store, one-shot runs reach the
  same nodes as a host that ran throughout.
- An authentication failure (`invalid_grant`, revoked) pauses the job and
  names the account, as push does today. Transport and quota failures back
  off, with the backoff state on the job node.
- **A trigger, later.** `events.watch` channels POST to an HTTPS URL with a
  valid certificate. The POST has no body, only a change signal, and
  Google's guide says notifications can be dropped and channels must be
  renewed by hand. A host with a public HTTPS address may contribute a
  route that calls `jobs.run {job}`. It is an accelerator with polling as
  its fallback (kb#189 §6.4), so it is optional and last (§10, G8).
- **The hostless property.** The family's extension contract proves the
  rule on a fake source. For any interleaving of changes in Google
  (creations, edits, exceptions, cancellations and a 410) and import runs,
  the resulting nodes equal those of one full import of Google's final
  state, plus `cancelled` on whatever disappeared.

## 7. The port

`@kb/routines` declares a second port beside `CalendarPort` (push):

```ts
interface CalendarSource {
  readonly calendars: () => Effect<readonly GoogleCalendar[], SyncError>;
  readonly events: (calendar: string, from: { syncToken?: string; pageToken?: string })
    => Effect<{ items: readonly RemoteEvent[]; nextPageToken?: string; nextSyncToken?: string }, SyncError>;
}
```

- `RemoteEvent` is the semantic shape: the fields of §2 with Google's wire
  names decoded. `SyncError` gains `sync_token_gone` for a 410.
- The memory fake and the Google HTTP adapter (`@kb/routines-gcal`) join one
  `calendarSourceContract` suite, as both push adapters join
  `calendarContract`. The suite covers paging, the token on the last page
  only, deletions in deltas, and the 410.

## 8. Store growth

An imported event node with its fields is about 0.9 KB of JSONL; this
repository's store averages about 0.6 KB a node. Some estimates:

| Calendar | Nodes a year | JSONL a year |
|---|---:|---:|
| a busy work calendar: 10 one-off meetings a working day | ~2,500 | ~2.2 MB |
| a personal calendar: 3 one-off events a week, plus 20 series | ~180 | ~0.2 MB |

- A series is one node, however long it runs, plus only its exceptions.
- Every change in Google rewrites one line, so git history grows with the
  change rate.
- **In-process speed is the real cost.** kb#189 §1.4 measured the command
  phase at 198 ms with 360 nodes and 270 ms with 1,209. That phase rebuilds
  the whole index on every open. 2,500 more nodes a year would add roughly
  150 ms a year to every in-process command, until that record's step 7
  ("open only what a command reads") lands. With a host running (§5 of the
  same record), it is absorbed.
- The levers are `import from` (default 90 days back), series collapsing to
  one node, and, if needed, pruning past events that carry nothing of the
  person's. Pruning would be safe, because Google still holds them and a
  resync would bring them back (decision 3).

## 9. Two-way sync: deferred

The import is one-way. A person's edit to a Google-owned field stays in kb
until Google next changes that event, and never reaches Google. Push-back
(data-plane design D9 and E5) would mean:

- an opt-in per subscribed calendar;
- title and time becoming kb-owned on that calendar;
- puts with `If-Match` on the event's etag;
- the wider `calendar.events` scope, and only where Google says the person
  may edit the event.

It is recorded as a `#gap` ("GAP: imported Google events are one-way; kb
cannot change them in Google"), not built.

## 10. Implementation plan, in small PRs

Each PR restructures first, in a commit that preserves behaviour, and adds
behaviour in a separate commit (Rule 1).

| # | PR | Needs |
|---|---|---|
| G0 | This record and the two-way `#gap` | — |
| — | **E2** (occurrences: `on at`, optional `state`, several a day, one materialize function) and **E3** (managed sync fields), from the data-plane design | — |
| — | **Jobs** (kb#189 step 11: `#job`, `job: true`, `jobs.run`, `kb jobs`) | — |
| G1 | **Fields and guards.** `source` on calendars, `import from`, `gcal sync token`, `event status`, `attendees`, `meeting link`, `location`, `description`, each managed. The unique key (calendar, `gcal event id`) on events and (series, `gcal event id`) on occurrences. The push guard on `repeat` limited to push calendars. The guard refusing a `google` calendar that holds a kb calendar's id | E2, E3 |
| G2 | **The reader.** Expansion through `RRuleSet` (multi-line recurrence, read only). An occurrence's own text and duration. `event status = cancelled` drawn as not happening. Whole-day durations for all-day events. All pure, with DST and all-day tests | E2 |
| G3 | **Decoding.** A pure `remoteToWrites(event, calendar, lookup)` that turns a single event, master, exception or cancellation into node writes, with zones and all-day handling, the echo filter and the window. Property tests over generated Google events | G1, G2 |
| G4 | **The port.** `CalendarSource`, the memory fake, the Google adapter, and `calendarSourceContract` (paging, token on the last page, deltas, 410) | — |
| G5 | **The action.** `ext.routines.import`: first import, incremental runs, the 410 reconcile, bounded transactions, the token rule, preview. Its seeded `#job` node. The hostless property in the extension contract | G3, G4, jobs |
| G6 | **Setup.** Incremental consent for the two read scopes, and the calendar picker as procedure steps. Adding, pausing and unsubscribing a `source = google` calendar | G5 |
| G7 | **The page.** The calendar and the day page draw imported events and their occurrences. A managed row says "Google writes this" | G2, G5 |
| G8 | *(optional)* The push trigger: an `events.watch` channel and its renewal, on a host with a public HTTPS address | G5 |

**Live acceptance**, with the owner's own account:

- consent with the two added scopes;
- whether `nextSyncToken` changes on an empty delta;
- what a "this and following" edit sends;
- a 410 forced by an ACL change;
- an all-day multi-day event;
- an exception moved across a DST change.

## 11. For the owner

Each decision has a recommendation.

1. **Store every imported event as a node.** This supersedes D8, §6.4 and E4
   of the data-plane design (the `KB_DATA` cache, virtual nodes, and nodes
   only on annotation). **Recommend yes.**
2. **The import window.** **Recommend 90 days back from the first import,
   and every future event.** The person may move it per calendar.
3. **Pruning past events that hold nothing of yours.** **Recommend off**,
   and revisit when store growth or in-process speed is felt (§8).
4. **A person's edit to a Google-owned field** is allowed, being managed,
   not locked, and is overwritten when Google next changes the event.
   **Recommend yes.** Your own words go on children and your own fields.
5. **"This and following" splits.** **Recommend that the import never moves
   your occurrences** to the new series. They stay, shown as outside their
   series.
6. **Scopes.** **Recommend `calendar.calendarlist.readonly` with
   `calendar.events.readonly`**, rather than the wider `calendar.readonly`.
7. **Two-way sync.** **Recommend deferring it**, as a gap (§9).
8. **A deleted imported node comes back** when Google next reports the
   event. **Recommend yes for now.** A "dismissed" marker that keeps an
   event out can come later, if it is wanted.
