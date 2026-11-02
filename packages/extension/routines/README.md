# Routines → Google Calendar (phase 1)

The canonical design is [routines → Google Calendar](../../../docs/research/2026-11-02-kb-routines-gcal.md)
([design PR #97](https://github.com/popemkt/kb/pull/97)).
This family is hosted by `kb ui`, off by default. The engine has no frontend
package: use ordinary outline fields and `ext.routines.*` actions. Agenda, sync
dock and conflict cards are reserved for the frontend pass.

## Owner setup (once per person)

1. In your own Google Cloud project, enable the **Google Calendar API**. Configure
   the OAuth consent screen, add `https://www.googleapis.com/auth/calendar.app.created`,
   and set publishing status to **In production**. Google's external **Testing**
   status expires these refresh tokens after seven days. Create an OAuth client
   of type **Desktop app**, using your own project rather than shared credentials.
   [Google desktop OAuth documentation](https://developers.google.com/identity/protocols/oauth2/native-app).
2. On the shared server, create a private directory and dotenv file outside the
   repository, for example `~/.config/secrets/kb-routines.env` (directory `0700`, file `0600`).
   Put the downloaded desktop client ID and client secret in `GOOGLE_CLIENT_ID`
   and `GOOGLE_CLIENT_SECRET`. Reserve `GOOGLE_REFRESH_TOKEN` for Connect to write.
   Never put actual credentials in kb, a PR, or a sync log.
3. Enable the family with `extension.switch {"name":"routines","on":true}`.
   Create one `#google-account` node per person. Set **email** to its label and
   its three secret fields to absolute references, for example:

   ```text
   client id:     dotenv:/home/you/.config/secrets/kb-routines.env#GOOGLE_CLIENT_ID
   client secret: dotenv:/home/you/.config/secrets/kb-routines.env#GOOGLE_CLIENT_SECRET
   refresh token: dotenv:/home/you/.config/secrets/kb-routines.env#GOOGLE_REFRESH_TOKEN
   ```

4. Create a `#calendar` node linked to that account. Leave **calendar id** empty,
   use adapter **google**, timezone **Asia/Ho_Chi_Minh**, and sync **preview**.
   Run `ext.routines.binding {"calendar":"<calendar-node-id>"}`. The person must
   grant that digest through `sandbox.trust {"digest":"sha256:…"}` on the server.
   Trust is machine-local and covers account, adapter, calendar ID and secret
   references. Changing any of those requires a new grant.
5. Run `ext.routines.connect` with the same calendar argument, then open its URL
   in your own browser. Use the correct Google account. A local browser reaches
   the loopback callback directly. For a browser on another machine, copy the
   complete failed `http://127.0.0.1:…/callback?code=…&state=…` redirect from its
   address bar into `ext.routines.finish {"calendar":"…","redirect":"…"}`.
   Do not paste it into chat. A local callback uses `finish` without `redirect`.
   Connect validates state and PKCE, saves the refresh token privately and creates
   a new **kb routines** app calendar. It never adopts an existing personal calendar.
6. `finish` returns the new binding digest; grant it (the newly created calendar
   ID changes the binding). Use `kb ui --public-origin https://<your-kb-host>` so
   event backlinks point to the shared server. Start only this server for sync.
   Keep other kb copies in preview or paused. Set sync **on** when ready.

The email field identifies whose configuration this is; OAuth account selection
is made in Google's consent page. Tokens stay server-side. `invalid_grant` or
revoked authorization stops that account until Connect succeeds again.

## Editing and operating

Tag a node `#routine`, choose its calendar, **starts**, optional **at** (`HH:MM`),
**duration** in minutes and an RRULE body such as `FREQ=WEEKLY;BYDAY=MO,WE,FR`.
An empty RRULE is a one-off; an empty time is all-day. **repeats from** currently
supports **schedule** only. A completion-based rule reports an invalid rule.
Add child `#occurrence` nodes with original **on** date, state **done**, **skipped**
or **moved**, and (for moves) **moved to** plus optional **at**. One fact per day.
Done days show ✅, grey, and no reminders; ordinary days use calendar defaults.

- `ext.routines.preview {}` returns projected events without contacting Google.
- `ext.routines.status {}` reads the local units, issues and bounded sync log.
  The `routines.status` channel answers status requests without a dedicated view.
- `ext.routines.sync {}` retries pending/failed work immediately. Paused/preview
  calendars and untrusted bindings still make no requests.
- `ext.routines.resolve {"key":"<unit-key>"}` explicitly resolves a conflict using
  kb. Remote edits otherwise remain visible as conflicts; no automatic adoption.
- `ext.routines.recreate {"key":"…"}` explicitly recreates an event deleted in
  Google with a fresh generation. Editing the routine does not resurrect it.
- `ext.routines.release {"keys":["…"]}` releases the exact held deletion plans
  after inspection. Deleting a routine ends its series; more than five series or
  more than 20% of active units requires release.

Sync state lives in a separate local SQLite-backed kb store, at
`$XDG_STATE_HOME/kb/ops/<SHA-256-of-root>/` (default `~/.local/state/kb/ops/…`), outside the source store and git. Back up
that directory with the server's application data. It holds no credential values.
The storage port and adapters share one contract suite; the Calendar client and
fake share another. Network recovery retains a write journal and conditional
etags, with a ten-attempt cap; an edit or Sync now retries exhausted work. A successful
poll also requeues transport-exhausted work after connectivity returns. Auth and
permanent failures remain stopped.

Unit tests use an in-memory Calendar fake and a loopback HTTP server which
refuses external hosts. Live consent, actual Google expansion/notifications,
phone display, account revocation and an hour-long real network outage still
require owner acceptance testing. Polling uses 20 seconds while viewing routines,
60 seconds with a kb tab open, and 5 minutes otherwise; a full reconciliation
runs after 04:00 in the calendar zone.
