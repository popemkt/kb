import { bundledSeed } from "@kb/bundled";
import { SYSTEM_IDS, backdropOptionId } from "@kb/model";
import { FIXTURE_TIMESTAMP } from "./fixture.ts";

// The same seed as server.ts, read at discovery time so every contributed
// option becomes a schedulable test rather than an iteration inside one.
export const backdropOptions =
  bundledSeed(FIXTURE_TIMESTAMP).find((node) => node.id === SYSTEM_IDS.backdropField)?.children ??
  [];
if (backdropOptions.length === 0) throw new Error("no backdrop is contributed");
// These existing coverage sentinels must remain schedulable even if a seed
// edit accidentally removes an option; missing tests cannot count as green.
for (const required of ["backdrops.lens", "backdrops.floating-geometry"]) {
  if (!backdropOptions.includes(backdropOptionId(required))) {
    throw new Error(`missing backdrop coverage sentinel: ${required}`);
  }
}
