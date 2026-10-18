/**
 * Regenerate `EXAMPLE_PAGE_MODULE` from the example's page half as the
 * server bundles it. Run: `bun run gen:example-page`.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { EXAMPLE_PAGE_MODULE, examplePageHalf, examplePageModule } from "../src/example-page.ts";

if (import.meta.main) {
  const page = await Effect.runPromise(examplePageHalf());
  await writeFile(
    join(import.meta.dir, "../../../..", EXAMPLE_PAGE_MODULE),
    examplePageModule(page),
  );
  console.log(`wrote ${EXAMPLE_PAGE_MODULE}`);
}
