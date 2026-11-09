# Capability admission and an absent point owner

2026-11-09. Step 13 of [extensibility parity](2026-11-08-extensibility-parity.md).
The live contract is [Capability admission](../../DESIGN.md#capability-admission).

The published `quote-source` and `quotes` extensions were installed separately
from GitHub, revision `20a4e142a98ebfbc3d96af79261494cd97aee182`, already reachable
from kb-extensions main. They import no code from each other. This also proves
compatibility with their older, code-only `uses` declaration.

The test created `/tmp/kb-admission-e2e-rASA1p/root` and scratch `KB_HOME`,
`KB_DATA` and `XDG_CACHE_HOME`. A fixture trusted the reviewed digests only in
that scratch profile. It did not approve code in the person's profile.

```text
$ kb ext install github:popemkt/kb-extensions/extensions/quote-source@20a4e142a98ebfbc3d96af79261494cd97aee182
succeeded; trusted: false
trust fixture: quote-source
  sha256:630dfa80f999844ced29e15c476771beee4ca453f34c496b4aaee1dabde4a82d
extension.list:
  name: quote-source
  uses: [{point: ext.quotes.sources, from: null}]
  failures: []
Settings: Waiting
  waiting for ext.quotes.sources from quotes
  no Error pill and no alert
```

A real Chromium page showed the dependency in the extension's always-visible
summary, without opening its Details. The screenshot is `step13-waiting.png`
in the builder thread's storage.

```text
$ kb ext install github:popemkt/kb-extensions/extensions/quotes@20a4e142a98ebfbc3d96af79261494cd97aee182
succeeded; trusted: false
trust fixture: quotes
  sha256:ca721ae659d523cfe31962ea504d72dc24369fe2be8e9e2539a0ff48b46bb71f
$ kb action-invoke '{"id":"ext.quotes.list","input":{}}'
succeeded:
  [{text: "A point connects independent plugins.", author: "kb sample"}]
quote-source uses: [{point: ext.quotes.sources, from: quotes}]
quote-source failures: []
Settings: waiting status cleared
```

The backend admission tests additionally put `throw new Error("MODULE IMPORTED")`
at the start of a module with a missing native point requirement. Admission
returns the missing-capability reason without executing that marker. The page
import test uses a nonexistent module URL and receives the same policy refusal
before any import attempt. Manifest names, kernels, tiers, replacement roles
and reaction matches use the shared admission checker and schemas. Host-bound
reaction constraints and point-use bounds cover descendants; the stored match
cannot broaden after admission. The bundled family contract compares the
listed point definitions against real page-kernel declarations.

Evidence: `/tmp/kb-parity-admission-e2e.ts`, `/tmp/kb-parity-admission-e2e.log`,
and `/home/popemkt/.bb/thread-storage/thr_aribmqh2md/step13-waiting.png`.
No additional repository gap is closed: the broader page-admission gap
`01M5ZC6V2ZAVDG9972PADX58S0` still concerns importing and decoding page code in
the admission gate. This step checks its declared requirements before import.
