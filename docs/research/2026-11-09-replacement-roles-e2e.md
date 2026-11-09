# Installed replacement roles: end-to-end evidence

Date: 2026-11-09. The backend implementation is committed alongside this
record. Sample source: [`popemkt/kb-extensions` at
`7152433b2eda4e56f1410b8caeb8cd58e1d9cbc7`](https://github.com/popemkt/kb-extensions/tree/7152433b2eda4e56f1410b8caeb8cd58e1d9cbc7).
The live contract is [Provider roles](../../DESIGN.md#provider-roles).

The real CLI installed a GitHub tree into a scratch store, with scratch
`KB_HOME`, `KB_DATA` and cache. Playwright opened the built page served by
`startUi`. A test fixture supplied trust through `CodeTrust` in that scratch
profile only. No approval bypass was added to the product. The trust sheet
was opened and captured before the fixture granted trust.

`plain-fields` imports only the host SDK and its own server declaration.
The digest-covered manifest claims `ui.field-editor`, priority 50, with
`capabilities.page: full`. Its row component uses the SDK's field-value
parser and checked writes. The outline, tables and settings read the same
role through `useFieldEditor`.

A separate tree, `fixtures/failing/plain-fields`, deliberately throws. It
is absent from the marketplace catalog and normal extension folder. A
local-scope install shadows the store-scope sample, and its different
digest needs separate trust. This exercises recovery without shipping a
fault switch in the normal sample.

Paths below are shortened to `$ROOT`; `$REV` is the source revision above.

```text
$ kb --root $ROOT --json ext install github:popemkt/kb-extensions/extensions/plain-fields@$REV
succeeded; plain-fields; trusted=false
untrusted: no plain-fields row; bundled field editor remains
trust sheet: Replaces ui.field-editor · priority 50 · Plain one-line field rows
trust fixture (scratch profile only): plain-fields
trusted: plain-fields elected; untouched empty input stays valid
ordinary provider-field write: sys.extension.outline persisted; bundled editor elected

$ kb --root $ROOT --json unset sys.role.ui.field-editor sys.f.provider
succeeded
$ kb --root $ROOT --json ext install github:popemkt/kb-extensions/fixtures/failing/plain-fields@$REV --scope local
succeeded; plain-fields; trusted=false
trust fixture (scratch profile only): plain-fields
throwing fixture: toast names plain-fields; bundled field editor renders instead
role report: ui.field-editor · page · using outline
outline · priority 100 · default
plain-fields · priority 50 · faulted: Recovery fixture render failed
PASS
```

The focused admission tests also prove that an unknown role is refused
before server import, a page claim below its role's tier is refused, and
changing only a replacement claim changes the closure digest. The shared
role contract covers service, single and keyed roles, including child
approval inheritance and default-provider protection.

Step 8 addresses threat T16 for the first installed role. MECE finding 12
(per-type field editors) remains for its separate editor step. The
keybinding inspection consumer remains explicitly deferred under
`GAP [[01M6YS6XH9XS4TX7S7AYWXJX3A]]` until the follow-up after PR #136.
