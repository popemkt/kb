/** A server's current page source and retained history share one startup lifetime. */
import { Effect, type Scope } from "effect";
import type { CodeImagePort } from "@kb/contracts";
import { imagePageFiles, withPageHistory, type PageFiles } from "./assets.ts";
import {
  captureKeptFiles,
  directoryBuildSource,
  heldBuildSource,
  recordBuild,
} from "./build-archive.ts";

export const preparePageDelivery = Effect.fn("kb.ui.preparePageDelivery")(function* (
  image: CodeImagePort | undefined,
  builds: string | null,
  dist: string,
  scope: Scope.Scope,
) {
  const files: PageFiles | undefined =
    image === undefined
      ? undefined
      : withPageHistory(
          imagePageFiles(image),
          builds === null ? new Map() : yield* captureKeptFiles(builds),
        );
  const keep =
    builds === null
      ? Effect.void
      : image === undefined
        ? Effect.asVoid(Effect.forkIn(recordBuild(builds, directoryBuildSource(dist)), scope))
        : recordBuild(builds, heldBuildSource(image));
  return { files, keep };
});
