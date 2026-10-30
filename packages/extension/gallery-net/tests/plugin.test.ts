/**
 * The server's entry contributes the gallery's actions under the ids the
 * page calls them by (`GALLERY_ACTIONS`), so a renamed definition cannot
 * leave the page calling an id nothing serves.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ActionPoint } from "@kb/contracts";
import { makeKernel } from "@kb/plugin";
import { GALLERY_ACTIONS } from "@kb/gallery";
import { galleryServerPlugin } from "../src/index.ts";

describe("the gallery's server entry", () => {
  test("serves every action the page calls, by the id the page calls it by", async () => {
    const ids = await Effect.runPromise(
      Effect.gen(function* () {
        const kernel = makeKernel();
        yield* kernel.load(galleryServerPlugin());
        const contributed = kernel.contributions(ActionPoint).map(({ id }) => id);
        yield* kernel.shutdown;
        return contributed;
      }),
    );
    expect(ids.toSorted()).toEqual(Object.values(GALLERY_ACTIONS).toSorted());
  });
});
