/**
 * What every `bun test` run loads before its first test file, in order:
 * fast-check's seed (`fast-check-seed.ts`), then the run's scratch home
 * and data (`test-home.ts`). The one list. The root `bunfig.toml` names
 * this module, and so does each `bun test` package's own `bunfig.toml`.
 * Bun reads the config of the directory it runs in, and only that one, so
 * a suite run from its package directory is isolated as a root run is.
 * The harness (`test-preload.test.ts`) holds every such package to it.
 */
// oxlint-disable-next-line import/no-unassigned-import -- a preload is what its modules do on load
import "./fast-check-seed.ts";
// oxlint-disable-next-line import/no-unassigned-import -- a preload is what its modules do on load
import "./test-home.ts";
