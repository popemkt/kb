import { Context, type Effect, Schema } from "effect";
import { z } from "zod";

export class SourceError extends Schema.TaggedError<SourceError>()("Kb/SourceError", {
  message: Schema.String,
}) {
  static from(this: void, error: unknown): SourceError {
    return error instanceof SourceError
      ? error
      : new SourceError({ message: error instanceof Error ? error.message : String(error) });
  }
}
export interface GithubSource {
  readonly repo: string;
  readonly path: string;
  readonly ref: string;
}
export interface PinnedSource {
  readonly repo: string;
  readonly path: string;
  readonly rev: string;
}
export interface SourceFile {
  readonly path: string;
  readonly mode: "100644" | "100755";
  readonly bytes: Uint8Array;
}
export interface SourceTree {
  readonly name: string;
  readonly files: readonly SourceFile[];
  readonly ignored: readonly string[];
  readonly hash: string;
}
export class SourceReader extends Context.Service<
  SourceReader,
  {
    readonly resolve: (source: GithubSource) => Effect.Effect<PinnedSource, SourceError>;
    readonly read: (source: PinnedSource) => Effect.Effect<SourceTree, SourceError>;
  }
>()("kb/SourceReader") {}

const repoSchema = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/);
export const fullRev = z.string().regex(/^[a-f0-9]{40}$/);
export const SOURCE_LIMITS = {
  files: 512,
  bytes: 8 * 1024 * 1024,
  pathBytes: 4096,
  segmentBytes: 255,
  depth: 64,
} as const;
const pathEncoder = new TextEncoder();
export const sourcePath = z.string().refine((path) => {
  if (path === "") return true;
  if (
    path.length > SOURCE_LIMITS.pathBytes ||
    pathEncoder.encode(path).length > SOURCE_LIMITS.pathBytes ||
    path.startsWith("/") ||
    // oxlint-disable-next-line eslint/no-control-regex -- reject control characters in untrusted source paths
    /[\\\x00-\x1f:]/.test(path)
  )
    return false;
  const parts = path.split("/");
  return (
    parts.length <= SOURCE_LIMITS.depth &&
    parts.every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        pathEncoder.encode(part).length <= SOURCE_LIMITS.segmentBytes,
    )
  );
}, "source path must be a bounded relative regular-file path without traversal");
export const pinnedSchema = z.object({ repo: repoSchema, path: sourcePath, rev: fullRev });
const githubSchema = z.object({
  repo: repoSchema,
  path: sourcePath,
  ref: z
    .string()
    .min(1)
    .refine(
      // oxlint-disable-next-line eslint/no-control-regex -- refs cannot contain control characters or spaces
      (ref) => !ref.startsWith("-") && !/[\x00-\x20]/.test(ref) && !/^[a-f0-9]{4,39}$/i.test(ref),
      "abbreviated sha or invalid ref",
    ),
});
/** Parse one GitHub directory; names and links are resolved by their own surfaces. */
export function parseSource(input: string): GithubSource {
  let value = input;
  if (value.startsWith("https://github.com/")) {
    const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/([^/]+)(?:\/(.*))?$/.exec(value);
    if (match === null) throw new SourceError({ message: "expected a GitHub tree URL" });
    value = `github:${match[1]}/${match[3] ?? ""}@${decodeURIComponent(match[2] ?? "")}`;
  }
  const match = /^github:([^/]+\/[^/@]+)(?:\/([^@]*))?(?:@(.+))?$/.exec(value);
  const parsed = githubSchema.safeParse(
    match === null ? null : { repo: match[1], path: match[2] ?? "", ref: match[3] ?? "HEAD" },
  );
  if (!parsed.success)
    throw new SourceError({
      message: "expected github:owner/repo[/path][@ref] with a full sha or named ref",
    });
  return parsed.data;
}

/** One ref precedence for every source adapter: peeled tags, tags, then heads. */
export function pinSource(source: GithubSource, refs: ReadonlyMap<string, string>): PinnedSource {
  const valid = githubSchema.parse(source);
  const literal = fullRev.safeParse(valid.ref);
  const names =
    valid.ref === "HEAD"
      ? ["HEAD"]
      : [`refs/tags/${valid.ref}^{}`, `refs/tags/${valid.ref}`, `refs/heads/${valid.ref}`];
  return pinnedSchema.parse({
    repo: valid.repo,
    path: valid.path,
    rev: literal.success
      ? literal.data
      : names.map((name) => refs.get(name)).find((rev) => rev !== undefined),
  });
}

/** Only a repository's branches and tags confer provenance; HEAD and pull refs do not. */
export function isRepositoryRef(name: string): boolean {
  return name.startsWith("refs/heads/") || name.startsWith("refs/tags/");
}
