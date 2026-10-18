/**
 * The example extension's page half as the server bundles and serves it,
 * and where the page's tests read those bytes from: a generated module of
 * `@kb/ui`'s test support (`EXAMPLE_PAGE_HALF`), held to a fresh bundle by
 * `tests/example-page.test.ts`. So the page's test loads exactly what a
 * server serves, though the page's runner cannot bundle.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { bunFileSystemLayer, closureOf } from "@kb/runtime";
import { EXAMPLE, writeExampleEffect } from "./example-extension.ts";

/** The generated module, from the workspace root. */
export const EXAMPLE_PAGE_MODULE = "packages/app/ui/src/test-support/example-page.text.ts";

/** The example's page half, bundled now from its files. */
export const examplePageHalf = Effect.fn("test.examplePageHalf")(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "kb-example-page-"))),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );
  yield* writeExampleEffect(root);
  const { page } = yield* closureOf(root, `${EXAMPLE}.ts`).pipe(
    Effect.provide(bunFileSystemLayer),
    Effect.mapError((why) => new Error(`the example cannot be closed over: ${why}`)),
    Effect.orDie,
  );
  if (page === null) return yield* Effect.die(new Error("the example has no page half"));
  return page;
}, Effect.scoped);

/** The generated module's text for `page`. */
export function examplePageModule(page: string): string {
  return [
    "/**",
    " * GENERATED — do not edit by hand.",
    " * Regenerate: bun run gen:example-page",
    " *",
    " * The example repository extension's page half (`EXAMPLE_EXTENSION`,",
    " * `@kb/test-kit`), as the server bundles and serves it.",
    " */",
    `export const EXAMPLE_PAGE_HALF: string = ${JSON.stringify(page)};`,
    "",
  ].join("\n");
}
