import { Effect } from "effect";
import { z } from "zod";
import {
  SourceError,
  pinnedSchema,
  sourcePath,
  type PinnedSource,
  type SourceTree,
} from "./model.ts";
import { checkedTree } from "./tree.ts";

export const artifactName = z.string().regex(/^[\w][\w.-]*$/);
const EntrySource = z.union([
  z.object({ path: sourcePath }).strict(),
  z
    .object({ github: pinnedSchema.shape.repo, path: sourcePath, rev: pinnedSchema.shape.rev })
    .strict(),
]);
export const MarketplaceIndexSchema = z
  .object({
    version: z.literal(1),
    name: artifactName,
    extensions: z
      .array(
        z
          .object({ name: artifactName, description: z.string().optional(), source: EntrySource })
          .strict(),
      )
      .max(512),
  })
  .strict()
  .superRefine((index, ctx) => {
    const names = new Set<string>();
    for (const entry of index.extensions) {
      if (names.has(entry.name))
        ctx.addIssue({ code: "custom", message: `duplicate marketplace entry ${entry.name}` });
      names.add(entry.name);
    }
  });
export type MarketplaceIndex = z.infer<typeof MarketplaceIndexSchema>;
export const marketplaceTree = Effect.fn("source.marketplaceTree")(function* (tree: SourceTree) {
  const file = tree.files.find((candidate) => candidate.path === "kb-marketplace.json");
  if (file === undefined)
    return yield* new SourceError({ message: "marketplace has no kb-marketplace.json" });
  const index = yield* Effect.try({
    try: () =>
      MarketplaceIndexSchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)),
      ),
    catch: SourceError.from,
  });
  const selected = yield* checkedTree([file]);
  return {
    index,
    source: {
      ...selected,
      name: index.name,
      ignored: tree.files.filter((held) => held !== file).map(({ path }) => path),
    },
  };
});
/** Relative entries inherit the reviewed index commit and are relative to its directory. */
export function marketplaceEntryPin(
  pin: PinnedSource,
  source: MarketplaceIndex["extensions"][number]["source"],
): PinnedSource {
  return pinnedSchema.parse(
    "github" in source
      ? { repo: source.github, path: source.path, rev: source.rev }
      : { repo: pin.repo, path: [pin.path, source.path].filter(Boolean).join("/"), rev: pin.rev },
  );
}
export function marketplaceName(input: string): { name: string; marketplace?: string } {
  const match = /^([\w][\w.-]*)(?:@([\w][\w.-]*))?$/.exec(input);
  if (match === null) throw new SourceError({ message: "expected extension name[@marketplace]" });
  return {
    name: artifactName.parse(match[1]),
    ...(match[2] === undefined ? {} : { marketplace: artifactName.parse(match[2]) }),
  };
}
