/**
 * Whether this is the bench lane (`bun run bench`, which sets `KB_BENCH=1`):
 * a benchmark registers its tests only then, so the default lane neither runs
 * nor skips it. A skip is debt, and a benchmark is not. Bun names the test
 * file it is running in `Bun.argv`, so the command line cannot say which
 * lane this is; the environment can.
 */
export const benchmarkEnabled = Bun.env["KB_BENCH"] === "1";
