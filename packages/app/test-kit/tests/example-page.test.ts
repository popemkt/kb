import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { EXAMPLE_PAGE_MODULE, examplePageHalf } from "../src/example-page.ts";

/**
 * The page's test of a repository extension's page half loads the
 * generated module's bytes; this holds them to what a server bundles today.
 */
describe("the example's page half", () => {
  test("the generated module is the bundle a server serves", async () => {
    const page = await Effect.runPromise(examplePageHalf());
    const generated: unknown = await import(
      join(import.meta.dir, "../../../..", EXAMPLE_PAGE_MODULE)
    );
    expect(
      typeof generated === "object" && generated !== null && "EXAMPLE_PAGE_HALF" in generated
        ? generated.EXAMPLE_PAGE_HALF
        : undefined,
    ).toBe(page);
  });
});
