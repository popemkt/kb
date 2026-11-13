# Test-suite speed: 2026-11-13

Where the render, core and UI suites spend their time, which of that is
overhead rather than testing, and what changed. Times are seconds unless
marked. Local runs are on a 16-core Linux host shared with other agents
(load average 4 to 13 during these runs), each under the host's suite lock
and `nice -n 15`. CI numbers are from Validate run 43354552275 (main,
06f7dfe8).

## CI before

| Job | Runner | Job time | Test step |
|---|---|---:|---:|
| render (1/2) | macos-15 (3 cores) | 758 | 637 (85 tests, 1 worker) |
| render (2/2) | macos-15 | 513 | 408 (85 tests, 1 worker) |
| core | ubuntu-24.04 (4 cores) | 539 | 466 |
| ui (1/2), (2/2) | ubuntu-24.04 | 351, 287 | 314, 254 |
| verify | ubuntu-24.04 | 296 | 258 |

Render 1/2 bounds the run. Its tests sum to 623 s against 396 s in shard 2:
Playwright splits by count in file order, and the sixty `backdrop-*` tests,
about 8 s each, sort first (`#gap` 01M79GV526E3V6ZPVW0D6752FK).

## Render

Every test starts its own harness process (`tests-render/server/server.ts`)
over a fresh scratch root. The fixture was timed per test in one full run at
two workers (170 passed, 7.7 min wall, 908 s of test time):

| Per test | Median | Total | Share of test time |
|---|---:|---:|---:|
| harness spawn, until `/api/graph` answers | 850 ms | 143 s | 15.8% |
| harness stop | 35 ms | 6 s | 0.7% |
| first `page.goto` (89 tests use `page`) | 815 ms | 73 s | 8.0% |

The first page load is the test's own work, so it stays. The spawn is pure
overhead.

**A worker-scoped server with a reset endpoint was rejected.** The server
reads its home, data and cache directories from the process environment
whenever it needs them (`@kb/workspace-fs`'s `currentHome`, `currentData`
and `currentCache`), so two stores in one process would share a home store
and its trust. A test could then see another's trusted extension or
registered location. Moving those into a per-server service is a product
change. The same goes for an in-memory or SQLite store per test: the store
is not where the cost is. Bun's start and module load are, and a store
swapped inside a live server would still share that environment.

**What was done instead: a spare per worker.** `HarnessPool`
(`tests-render/harness-server.ts`) is worker-scoped. When a test takes its
harness, the pool starts the next one, which boots while the test runs.
Each test still gets its own process, scratch root, home store and port,
stopped when the test ends, so isolation is the same as before. A spare is
kept for the options of the last test (`test.use` is per file), and a test
that asks for others starts its own.

**The harness now runs as a test run (`NODE_ENV=test`).** Measuring turned
up a leak: every harness server published its test build into the person's
`~/.cache/kb/ui-builds` and pruned that archive to eight builds, evicting
their real ones (the log showed `PermissionDenied` while pruning). As a
test run, the server never falls back to the person's home, data or cache,
and with no cache it keeps no archive.

**Two workers on CI, tried and reverted.** See "CI" under After.

**Deferred.** `backdrop-load` and `backdrop-width` decide that a backdrop is
not a GPU scene by waiting out an 8 s timeout, because a GPU backdrop
suspends with an empty fallback and the page has no positive marker of a
backdrop's kind. Ten of the twenty backdrops do this in each file: about
160 s of the 908 s, all of it in CI shard 1. Fixing it needs that marker in
the UI (`#gap` 01M79GTJ1VVQ9YQEW68AQM68B0).

## Core

`bun test packages`, serial, took 634 s locally across 339 files (3817
tests). Per-file timings (`--timings --update-timings`):

| File | Time |
|---|---:|
| `app/cli/tests/surface-contract.test.ts` | 215.6 |
| `app/test-kit/tests/dst.test.ts` | 29.5 |
| `app/cli/tests/cli.test.ts` | 25.4 |
| `app/runtime/tests/extension-contract.test.ts` | 17.0 |
| `app/server/tests/extension-reload.test.ts` | 15.3 |
| everything else, 334 files | 331 |

Bun 1.4.2's `--parallel` runs files in isolated worker processes. The
preload runs per file there, so each file gets its own scratch home and data
root (a serial run shares one home across files), and each test still gets
its own `KB_DATA`. This was checked by printing them from probe files.

| Run | Wall | Result |
|---|---:|---|
| serial | 634 | 3817 pass |
| `--parallel=4` | 298 | 3817 pass |
| `--parallel=16` | 239 | 1 fail: DST "committed seeds" passed its 32 s budget |

The surface contract is a third of the serial time in one file, and Bun
parallelises files, so it bounds the run (`#gap`
01M79GV5XZGH57HF5174KXYYAB). Four workers is CI's core count, and sixteen
bought 59 s while pushing a CPU-bound property past its budget. The `test`
script now passes `--parallel=4`, and its reason lives in the root
`bunfig.toml`.

## UI

`test:ui` runs 23 Vitest packages one at a time (`nx --parallel=1`), each
forking a worker per core, and CI shards it two ways. Neither shard is on
the critical path (about 5 to 6 min against render's 12 to 13), and the
suite has gone red under load before (`validate.yml`'s note on the `ui`
job). It is left as it is.

## After

All local runs passed every test.

**The pool, A/B.** The same 65 render tests (the non-backdrop files with the
most tests) ran at two workers, alternating between main and this change,
with each test's wait for its harness recorded:

| Run | Harness wait, median | p90 | Total wait | Test time | Wall |
|---|---:|---:|---:|---:|---:|
| main | 865 ms | 985 ms | 59.8 | 272.0 | 145.9 |
| pool | 0 ms | 964 ms | 9.3 | 255.3 | 141.1 |
| main | 853 ms | 948 ms | 55.4 | 257.3 | 136.3 |
| pool | 0 ms | 981 ms | 8.8 | 222.4 | 119.3 |

The tests that still wait are each worker's first, and the first test of a
file whose `harnessOptions` differ from the file the worker ran before.

**Full render suite, two workers, local.** 170 passed in every run: 7.7 min
on main, then 7.3, 7.6 and 9.1 min with the pool. Wall time on this shared
host moves with its load (the GPU-heavy specs share its GPU with other
agents), so the A/B above is the measure of the pool. The full runs show
that the suite stays green.

**Core.** Serial 634 s, then `--parallel=4` at 298, 246 and 265 s: 3817 of
3817 passed in each run.

**CI, run 43371012192** (render at two workers per shard, core at four):

| Job | Before: test step | Before: tests summed | After: test step | After: tests summed |
|---|---:|---:|---:|---:|
| render (1/2) | 637 | 623 | 437 | 835 |
| render (2/2) | 408 | 396 | 499 | 956 |
| core | 466 | | 407 | |

Two workers on the three-core macOS runner slowed every test. The GPU-heavy
files more than doubled (lab 63 to 193 s, render 135 to 239 s,
head-band-contrast 93 to 188 s), shard 2 took longer than at one worker,
and `query-budget`'s frame-time assertion (the longest frame while the
query worker runs, under 250 ms) failed at 370 ms. CI went back to one
worker. The pool's saving and the closed backdrop timeout don't need a
second worker: shard 1 comes to about 623 − 85 − 110 ≈ 430 s of tests at
one worker, against 499 s for shard 2 at two.

Core gained less on CI than locally (466 to 407 s, against 634 to about
270 s here). The surface contract is the floor (`#gap`
01M79GV5XZGH57HF5174KXYYAB), and this runner takes it longer.

## Follow-up: the GPU host's element from the first render

The deferred backdrop timeout, closed. A GPU backdrop's lazy boundary now
shows the host's element, empty and `loading`, while the host's chunk loads,
where it showed nothing. So whether a frame holds the GPU host is settled in
the same render that shows the frame. `backdrop-load` and `backdrop-width`
wait until the head shows the chosen backdrop and read that, with no
timeout. A backdrop that never shows, or a GPU backdrop whose host never
finishes loading, now fails where it used to pass as "not a GPU scene".

The marker is the host's own element rather than a kind declared beside the
backdrop. The specs ask whether the shared GPU host draws a backdrop, and
the budget kinds (`BACKDROP_BUDGETS`) don't answer that: Unicorn and Arena
are GPU-budgeted but draw through their own runtimes, not the host.

The two files, at two workers, locally: 294 s of test time before, 182 s
after. The ten backdrops the host does not draw went from about 10 s each
to 2–3 s.
