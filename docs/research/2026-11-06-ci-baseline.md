# CI performance record: 2026-11-06

## Measurement: 2026-11-06 baseline

Sample: the latest 30 repository runs at 15:57 UTC, IDs 41698279061 through
42247804627, obtained with `gh run list --limit 30 --json ...`, then
`gh run view <id> --json jobs,attempt` and attempt logs. This includes 20
Validate and 10 Nightly runs; pending and cancelled jobs are excluded from
successful-job medians. Start delay is job start minus workflow creation,
so it includes scheduler/dependency delay, not just runner allocation.
Durations include setup and cache post-steps. Times are minutes.

| Job | Successful samples | Median start delay | Median execution | Maximum finish since trigger |
|---|---:|---:|---:|---:|
| verify | 20 | 0.05 | 4.95 | 7.15 |
| nix Ubuntu | 20 | 0.05 | 2.25 | 4.15 |
| nix macOS | 17 | 0.32 | 6.12 | 23.18 |
| core | 17 | 0.22 | 5.28 | 20.10 |
| ui 1/2 | 17 | 0.70 | 7.37 | 18.67 |
| ui 2/2 | 16 | 0.53 | 6.98 | 24.77 |
| render | 16 | 0.58 | 13.96 | 23.97 |
| nightly prepare | 3 | 0.05 | 0.52 | 0.65 |
| bundle | 3 | 0.60 | 0.68 | 1.52 |
| smoke macOS | 2 | 1.29 | 2.21 | 3.53 |
| publish | 2 | 3.54 | 0.23 | 3.80 |

Render is the normal critical path. Main run 42242547817 finished in 24.77
minutes, with UI 2/2 finishing last after queueing. There was already no
`needs: nix` on render: runner contention explains the apparent dependency.
Green-main workflow publication also already existed; the schedule previously
only pruned. It now retries publication of main through the same green gate.
`validate-green` accepts only a successful **push on main**, so a selectively
validated PR can never authorize publication.

Flake audit: 42242587247 attempt 1 records UI 2/2 as cancelled, not failed;
its log endpoint returns 404. No test identity can be inferred from a
28-minute cancelled job. No available UI log records an assertion failure.
41795515320 failed core's `the wire protocol > is the version recorded with
the wire it names` once; this is a version-consistency assertion, not evidence
of a timing flake. 41792737026 failed render's `every design system paints the page it is chosen
for (dark)` once: the selected swatch was yorha while the root still painted
transistor after 5 seconds. 41698279061 failed seed-golden and seed-migration
assertions (11 core tests). Each failure occurred in one of the 20 sampled
Validate runs; none demonstrates a same-commit assertion failure followed by
a passing retry. These remain strict failures; root-cause changes to UI are
outside this pipeline-only change.

Available attempt-1 logs show Nix flake snapshot hits in 17 Ubuntu jobs and
17 macOS jobs. Both were already warm in the latest successful main run.
Bun and Chromium had no configured cache, so no hit rate existed. Installer
cache hits are distinct from flake-store hits. Cancelled/missing logs prevent
claiming a complete cache denominator.
No test has been quarantined or retried into green. Manual reruns remain
visible in GitHub's attempt history. Missing logs are missing evidence,
not zero failures.

## First after-run: partition correction

[Run 42249947516](https://github.com/popemkt/kb/actions/runs/42249947516)
was green in **21m37s**. It missed the target: render 1/2 queued for 8m22s,
then executed for 13m15s; render 2/2 executed for 5m07s. All three adjacent
backdrop files landed in the first contiguous half (414 seconds combined).
The corrected suite makes each backdrop option a separate test and uses
Playwright test sharding with one worker per runner. Core passed on Ubuntu in 3m03s (baseline median
5m17s); UI shards took 7m43s and 6m24s; verify 4m20s; Nix macOS 5m43s;
Nix Ubuntu 2m10s. A competing Validate run held macOS slots during this run.
No target claim is based on subtracting that queue.


## First Linux UI run

[Run 42255674628](https://github.com/popemkt/kb/actions/runs/42255674628)
on `820a9e14` passed both Ubuntu UI shards in **4m14s and 4m19s**,
compared with the macOS baseline medians of 7.37 and 6.98 minutes.
Verify took 4m40s, core 2m40s and Nix Ubuntu 2m09s. Every Ubuntu job
finished within 4.7 minutes of the trigger.

The run failed because render 2/2 waited 42 minutes for a macOS runner
and was abandoned without executing a step. The aggregate failed closed.
Nix macOS waited 7.3 minutes and executed for 4m54s. Render 1/2 waited
10.2 minutes and executed for 10m57s (8.7 minutes of tests). All 60
backdrop cases fell in its contiguous test-count slice; the remaining
shard's estimated test time was 6.3 minutes from earlier timings. This
run proves Linux UI compatibility, not either end-to-end timing target.
