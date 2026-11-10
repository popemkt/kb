# Events → Google Calendar (phase 1)

The canonical design is [routines → Google Calendar](../../../docs/research/2026-11-02-kb-routines-gcal.md)
([design PR #97](https://github.com/popemkt/kb/pull/97)), and its restructure
into events is [§6 of the data plane design](../../../docs/research/2026-11-10-data-plane-fields-events.md)
([design PR #149](https://github.com/popemkt/kb/pull/149)). The family is
labelled **Events** and keeps its id, `routines`, as every id it seeds keeps
its own: what changed is labels, retired by the seed where nobody edited them.
This family is hosted by `kb ui`, off by default. Its browser half,
`@kb/routines-ui`, is the month, week and agenda calendar at `/calendar`
([DESIGN-UI.md → The routines calendar](../../../DESIGN-UI.md#the-routines-calendar));
ordinary outline fields and `ext.routines.*` actions work as well.

## Owner setup (once per person)

Setup is a wizard in the page: **Calendar → Set up sync** (or **Sync services**),
**Add sync service → Google** ([DESIGN-UI.md → Sync services](../../../DESIGN-UI.md#sync-services)).
Every step links to the Google Cloud Console page it needs, with your project
already chosen, and says what you will see there. In short:

1. **Project.** Create your own Google Cloud project (never shared
   credentials). When `gcloud` is signed in on kb's host, the wizard offers to
   create it and enable the API for you.
2. **Calendar API.** Enable the Google Calendar API on it.
3. **Consent screen.** Google Auth platform → Get started: app name, your
   email, audience **External**.
4. **Publish.** Audience → **Publish app**, so the status reads **In
   production**. In Testing, Google ends the connection after seven days.
   An app only you use stays unverified; Google's warning at sign-in is
   expected.
5. **OAuth client.** Clients → Create client, type **Web application**, with
   the **Authorized redirect URI** the wizard shows
   (`<public origin>/calendar/connect`; start kb with
   `kb ui --public-origin https://<your-kb-host>` so it is the address you
   open kb at). Paste the client ID and secret into the wizard, which checks
   them with Google before keeping them.
6. **Connect.** Connect with Google: you approve kb's binding on this host,
   sign in with the right account, and Google sends you back to kb with a
   refresh token kept on the host. kb asks only for
   `https://www.googleapis.com/auth/calendar.app.created`.
7. **Calendars.** Pick kb calendars to sync (or name a new one). Each gets its
   own new **kb routines** Google calendar; kb never adopts an existing
   personal calendar. Their sync is switched on.

Secrets never go into kb's nodes or the repository. The host keeps the client
ID, client secret and refresh token in its secret store (DESIGN.md →
[Writable host secrets](../../../DESIGN.md#writable-host-secrets)): the macOS
Keychain on a Mac, and on Linux a file in kb's data directory sealed with
`systemd-creds`, or with AES-256-GCM under a key file beside it where
`systemd-creds` cannot seal. The account node holds only the references
(`sealed:routines.<digest of the account id>.client-secret`, …), and the page never receives a
value after you paste it. Agents cannot read them, and cannot set up, connect
or remove a service: those actions require the person's approval.

Run sync from one server only, and keep other kb copies in preview or paused.
The email field labels the account and is Google's sign-in hint. `invalid_grant`
or revoked authorization stops that account until it is connected again.
**Remove** revokes kb's access at Google, erases the host's secrets, pauses and
unlinks its calendars and deletes the account node.

The setup actions, all `approval: "required"` except the reads:
`ext.routines.setup {}` (redirect URI, store, gcloud),
`ext.routines.binding {"node":"<account-or-calendar>"}` (the digest to trust),
`ext.routines.automate {"project":"…"}`, `ext.routines.client {"account","clientId","clientSecret"}`,
`ext.routines.connect {"account":"…"}`, `ext.routines.finish {"redirect":"…"}`,
`ext.routines.provision {"calendar":"…"}` and `ext.routines.remove {"account":"…"}`.

## Editing and operating

Tag a node `#event` (`sys.tag.routine`, which read `#routine` before), choose its
calendar, **starts**, optional **at** (`HH:MM`), **duration** in minutes and a
**repeat**, an RRULE body such as `FREQ=WEEKLY;BYDAY=MO,WE,FR`.
An empty repeat is a one-off; an empty time is all-day. **repeats from** currently
supports **schedule** only. A completion-based rule reports an invalid rule.
Add child `#occurrence` nodes with original **on** date, state **done**, **skipped**
or **moved**, and (for moves) **moved to** plus optional **at**. One fact per day.
A done fact keeps its **moved to**, so an instance moved and then ticked done stays
where it was moved; a skipped one is cancelled wherever it was.
A one-off takes a fact too, on its **starts** day: it is the one event's own state.
Done days show ✅, grey, and no reminders; ordinary days use calendar defaults.

- `ext.routines.preview {}` projects routines without contacting Google.
- `ext.routines.status {}` and the `routines.status` channel return routine/occurrence node fields and queued deletion IDs for release.
- `ext.routines.sync {}` retries pending/failed work; unchanged synced routines are no-ops.
- `ext.routines.release {"keys":["<routine-node-id>"]}` authorizes exact held deletions.
- Calendar **sync** values **preview** and **paused** stop outbound requests.

The behavior and Calendar port contract are specified once in the
[design's Simplified section](../../../docs/research/2026-11-02-kb-routines-gcal.md#simplified-2026-11-04).
Status fields are native graph fields on routines and occurrences: **gcal status**
(pending/synced/error), **gcal message**, **gcal link**, **gcal event id**, **synced at**.
The calendar view reads those fields and calls the actions above.

## Validation and remaining acceptance

Unit tests use the fake Calendar adapter; the Google adapter joins its shared
contract suite through a fake HTTP transport. No credentials or live Google calls
are needed. Projection tests cover RRULEs, all-day events and DST boundaries.
Live consent, Google exception retention across series updates, cancelled-instance
restoration, mobile reminders and token revocation remain owner acceptance checks.
