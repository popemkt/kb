# Extension UI trial — 2026-11-08

Step 6 implements [the install plan](../2026-11-06-plugin-install-plan.md#4-trust).

Trial: https://shared-server.taild98079.ts.net:10009/settings/extensions

The server runs this branch against `/home/popemkt/Projects/kb-trial-ext`, with
`KB_HOME=/tmp/kb-trial-ext-home`, `KB_DATA=/tmp/kb-trial-ext-data` and
`KB_CACHE=/tmp/kb-trial-ext-cache`. The sample marketplace is pre-added. The
trial installs and approvals were removed after capture; the owner can install
`hello` and `aurora` from the page and review them afresh. These are synthetic
actions; SDK backdrops still await owner approval of #107.

Screenshots were taken with headed Chromium on shared-server's Xvfb display.
Each browser was closed after capture. The screenshot fixture used sample branch
`kb-ui-trial-20261108`, initially from `23bbff27` to `b1f074f`, then from `b1f074f` to `01c99602` for the refreshed line-diff captures; sample main was unchanged.
The pending candidate was declined, leaving the approved digest running.

| State                              | Light                                      | Dark                                      |
| ---------------------------------- | ------------------------------------------ | ----------------------------------------- |
| Untrusted                          | [image](kb-trial-untrusted-light.png)      | [image](kb-trial-untrusted-dark.png)      |
| Trusted                            | [image](kb-trial-trusted-light.png)        | [image](kb-trial-trusted-dark.png)        |
| Pending update with running digest | [image](kb-trial-pending-light.png)        | [image](kb-trial-pending-dark.png)        |
| Expanded review, diff and reach    | [image](kb-trial-trust-expanded-light.png) | [image](kb-trial-trust-expanded-dark.png) |

The real page installed hello, showed untrusted metadata, trusted the reviewed
bundle without restart, updated to a new untrusted digest, retained the approved
running digest, and declined the update. Aurora exercised the dark untrusted and
trusted states. Both installs were removed through the page.

[The complete scratch-store acceptance transcript](install-acceptance.jsonl)
records GitHub-path install, marketplace/name install, a pushed update retaining
the approved running version, explicit trust, zero additional fetches for a
second store, uninstall and GC. Its own fresh home/data/cache and stores are
separate from the trial and the owner's stores. Non-TTY and MCP trust refusal
are included. The owned scratch PTY supplies only synthetic test approvals.

CI run 42451620455 exposed existing query-test sampling debt, tracked by
`01M6WV8JS4GPF0TRYDZY948C40`: all 100 round-trip comparisons passed, but only
7 randomly generated cases answered rows versus the quota of 8. The query
implementation, generator, quota and retry policy are unchanged. The gap is
recorded before another full gate run.

Run 42452522418 passed that query test, but exposed an empty CLI child response
in the existing socket/governance-required surface contract. Gap
`01M6WW0WE9QD8W2KCRM1NW8SHB` tracks the unreproduced failure. The helper now
retains exit/signal/stderr when no receipt is produced, rather than losing
them to a JSON parse error. No retry or assertion relaxation was added.

## Review round 1

The dock's own approval card now delegates to the same `ActionApproval` as
Settings and sandbox runs. Dock tests cover loading, rendered evidence,
failed reads and explicit decline. Bundle and file-set digests are distinct
in the Settings fixture.

All eight refreshed light/dark captures use a separate scratch store on
127.0.0.1:4395. They show line additions/removals, a baseline digest, totals,
and collapsed unchanged runs. The comparison is bounded before approval is
enabled. No owner-trial installs or approvals were changed for these captures.
Removed families are explicitly marked as retaining their nodes, with named
marketplace reinstall offers. The top review links, scope disclosure,
independent errors, trusted-row Review label and update summaries are covered.

Missing or inaccessible repositories still have an overly broad Git transport
error. This is deliberately tracked at its source owner as
`01M6WXNJH2JJD9956VC408R386`; the UI does not guess a failure classification.

The known design-system switch race also recurred in render run 42457579603:
the dark gallery selected Transistor while the root remained ZZZ. Gap
`01M6W4HV113Y6WKXZT1XN8B07E` was committed with a marker at that assertion;
#127 has since closed the measurement gap. This rebased branch removes its
node and marker and inherits the completion-based check. The
[paint-race record](../2026-11-08-design-system-paint-race.md) describes the
effective wait-bound change and the still-untraced callback-latency question.
