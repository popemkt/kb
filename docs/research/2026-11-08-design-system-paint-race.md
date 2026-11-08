# Design-system paint race

Investigation of gap `01M6W4HV113Y6WKXZT1XN8B07E`, which intermittently
fails the design-system render contract on macOS CI. The gallery selects
the next system while `<html data-theme>` still names the preceding one.

## Baseline measurements

Both runs used isolated checkouts on shared-server, separate scratch
`KB_HOME`, `KB_DATA` and `KB_CACHE`, nice 15, and two workers. They ran
sequentially, with zero retries and the existing five-second paint poll.

```sh
bun run test:render tests-render/design-system.e2e.ts \
  --repeat-each 10 --workers 2 --reporter=line,json
```

| Revision | Started (UTC) | Light failures | Dark failures | Total failures | Duration |
| --- | --- | --- | --- | --- | --- |
| main `8ff4a9c9` | 2026-11-08 07:38:03 | 0/10 | 0/10 | 0/20 | 74.3 s |
| #125 `66f9efdf` | 2026-11-08 07:39:43 | 0/10 | 0/10 | 0/20 | 76.6 s |

This sample does not show an increased failure rate on #125. It does not
establish equal failure rates or explain the macOS failures.

## Diagnosis

Temporary tracing on main also passed 20/20 with Chromium's CPU throttled
fourfold using the normal Vulkan launch arguments, and 20/20 with those
arguments removed to exercise the software path. Every traced selection
reached its transition callback. The latter run included native transition
rejections reporting a DOM-update timeout, without a failed paint assertion.
That rejection alone therefore does not identify the cause of this gap.

Draft #127 records native transition request, callback, update completion,
ready and finished events, with timestamps and the selected and painted
IDs. It prints the trace on failure and repeats the light/dark cases ten
times on CI. The assertions and timeout remain unchanged. Diagnosis is
still in progress; no behavior fix or gap closure is claimed here.
