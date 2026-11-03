# Routines → Google Calendar (phase 1)

The canonical design is [routines → Google Calendar](../../../docs/research/2026-11-02-kb-routines-gcal.md)
([design PR #97](https://github.com/popemkt/kb/pull/97)).
This family is hosted by `kb ui`, off by default. The engine has no frontend
package: use ordinary outline fields and `ext.routines.*` actions. The month/week/agenda calendar view is a later frontend pass.

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
A done fact keeps its **moved to**, so an instance moved and then ticked done stays
where it was moved; a skipped one is cancelled wherever it was.
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
The calendar view can use those fields and the actions above directly.

## Validation and remaining acceptance

Unit tests use the fake Calendar adapter; the Google adapter joins its shared
contract suite through a fake HTTP transport. No credentials or live Google calls
are needed. Projection tests cover RRULEs, all-day events and DST boundaries.
Live consent, Google exception retention across series updates, cancelled-instance
restoration, mobile reminders and token revocation remain owner acceptance checks.
