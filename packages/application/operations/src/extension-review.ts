import { Effect } from "effect";
import { z } from "zod";
import {
  CodeTrust,
  ExtensionCatalog,
  ExtensionStorage,
  ExtensionNameSchema,
  type ActionDefinition,
} from "@kb/contracts";
import { domainError } from "@kb/model";
import { changedFiles, FileChange } from "./source-diff.ts";

export const extensionDiffDef = {
  id: "extension.diff",
  title: "Review an extension's changes",
  description:
    "Offline file diff from the latest tree this machine trusted for this name to its selected locked tree. Does not fetch, import or trust.",
  mode: { kind: "read" } as const,
  inputSchema: z.object({ name: ExtensionNameSchema }),
  outputSchema: z.object({
    name: z.string(),
    from: z.string().nullable(),
    to: z.string(),
    files: z.array(FileChange),
  }),
} satisfies ActionDefinition;
export const extensionDiffEffect = Effect.fn("extension.diff")(function* (
  input: z.infer<typeof extensionDiffDef.inputSchema>,
) {
  const row = (yield* ExtensionCatalog).find(
    (candidate) => candidate.name === input.name && candidate.shadowed === undefined,
  );
  if (row?.origin.kind !== "install" || row.files === undefined)
    return yield* domainError("invalid_input", `no installed extension named ${input.name}`);
  const storage = yield* ExtensionStorage;
  const current = yield* storage.tree({ kind: "extension", name: row.name, files: row.files });
  if (current === null)
    return yield* domainError("not_found", "selected source is not fetched; run kb ext install");
  const baseline = (yield* (yield* CodeTrust).records)
    .filter((record) => record.name === row.name && record.files !== undefined)
    .toSorted((a, b) => b.at.localeCompare(a.at))[0];
  const before =
    baseline?.files === undefined
      ? null
      : yield* storage.tree({ kind: "extension", name: row.name, files: baseline.files });
  if (baseline !== undefined && before === null)
    return yield* domainError(
      "not_found",
      "last trusted source is not cached; restore it before reviewing this diff",
    );
  return {
    name: row.name,
    from: baseline?.files ?? null,
    to: row.files,
    files: changedFiles(before?.source.files ?? [], current.source.files),
  };
});
