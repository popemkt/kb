# Design-system paint race

Investigation and fix for gap `01M6W4HV113Y6WKXZT1XN8B07E`.

## Baseline measurements

Both requested runs used isolated checkouts on shared-server, separate
scratch `KB_HOME`, `KB_DATA` and `KB_CACHE`, nice 15, and two workers. They
ran sequentially, with zero retries and the original paint assertion.

```sh
bun run test:render tests-render/design-system.e2e.ts \
  --repeat-each 10 --workers 2 --reporter=line,json
```

| Revision        | Started (UTC)       | Light failures | Dark failures | Total failures | Duration |
| --------------- | ------------------- | -------------- | ------------- | -------------- | -------- |
| main `8ff4a9c9` | 2026-11-08 07:38:03 | 0/10           | 0/10          | 0/20           | 74.3 s   |
| #125 `66f9efdf` | 2026-11-08 07:39:43 | 0/10           | 0/10          | 0/20           | 76.6 s   |

These measurements show no increased failure rate on #125. They do not
establish equal failure rates: neither reproduced the intermittent failure.
Code comparison found the same sequence-counter publication guard in
`latestRead`; no #125-specific behavior change was identified.

## The measurement ordering

The measurement contract lives in `paint` in
[the render spec](../../packages/test-support/render-tests/tests-render/design-system.e2e.ts).
The gallery can reflect a graph write before the browser invokes the native
snapshot's DOM-update callback. The old helper could finish a computed-style
read in that interval, returning a new gallery choice and an older root theme.
An early read alone could not fail the old poll: it would retry for five
seconds. The historical failures therefore imply that the DOM-update callback
was delayed more than five seconds after the click. The cause of that delay
has not been traced.

A controlled regression holds the native callback behind a promise, without
adding a timer. The gallery selects a new system while the root still names
the old one. Against the old helper, the regression fails with
`a pending snapshot must not be measured as a completed paint`:
`measured` is already true while the callback is held. With the completion
wait, measurement stays pending, then returns the new root and matching
computed tokens after the callback is released. The same property is tested
when the visual transition is skipped.

The helper now awaits `updateCallbackDone`, whose
[native contract](https://www.w3.org/TR/css-view-transitions-1/#dom-viewtransition-updatecallbackdone)
reports the DOM update's completion independently of the animation. The test
first confirms the requested gallery selection so it observes that request's
transition, then checks the IDs and computed tokens immediately after the
update. It does not wait for the crossfade to finish, so the following choice
can still interrupt an animation. Callback errors propagate as test failures.

The effective wait bound changes from the poll's five seconds to the existing
60-second test timeout: the test now waits for the update event. No configured
timeout value increases, but the operation being waited on uses a wider bound.
Postconditions are checked immediately after completion. There are no retries,
fixed sleeps, production behavior changes, or narrowed CI gates.

## Additional diagnostics and limits

Temporary diagnostics did not reproduce the original intermittent CI failure:

| Diagnostic                                                                                                | Result                                                                    |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| main, Linux Vulkan, CPU throttled fourfold                                                                | 20/20 passed                                                              |
| main, Linux software path, CPU throttled fourfold                                                         | 20/20 passed                                                              |
| main, Linux, forced-WebGL2 canvas → default-backend canvas → light/dark choices, three rounds, one worker | 12/12 passed                                                              |
| first instrumented macOS run, main and #125                                                               | 20/20 design-system cases passed on each                                  |
| ordered buffered macOS run, main and #125, two jobs per revision                                          | 80/80 cases passed on each, including 40 design-system cases per revision |

The first macOS instrumentation changed the native API overload and shard
boundaries. The ordered run preserved the overload, buffered its trace without
console traffic, and repeated the two canvas specs before the design-system
spec. Those targeted runs were diagnostics, not full-gate admission evidence.
All temporary instrumentation and workflow changes are removed.

The historical failing macOS attempt was not traced directly. The controlled
regression proves the premature-measurement ordering; the zero-failure
baselines cannot demonstrate a statistical reduction in the original flake.
The cause of the more-than-five-second callback delay remains untraced.

The remaining latency question is whether CI frame starvation caused those
delays, or whether a person on a slow machine could also see a stale theme for
seconds. This change establishes a completion-based test oracle; it does not
establish the cause of that latency or claim a production responsiveness fix.

## Final validation

The repeat command above passed 40/40 cases: 10 light, 10 dark, 10 held native
updates and 10 held updates with skipped animation. Zero retries. The old
helper failed the controlled pending-update assertion before the fix.

The full local suites then passed, sequentially at nice 15:

- `bun run test`: 3,348 passed, zero failures.
- `bun run test:ui`: 3,789 passed across 17 projects, with `VITEST_MAX_WORKERS=2`.
- `bun run test:render --workers 2`: 138 passed, including all four design-system cases in the full-suite ordering.

All runs used scratch homes/data/cache. The final diff restores the normal CI
workflow and contains only this record and the render spec. The gap node and
its code marker are removed in the commit that applies the measurement fix.
