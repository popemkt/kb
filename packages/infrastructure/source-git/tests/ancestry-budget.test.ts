import { expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { SourceError } from "@kb/extension-source";
import { verifyCommit } from "../src/references.ts";
import type { GitTransport } from "../src/transport.ts";

const git: GitTransport = () =>
  Effect.fail(
    new SourceError({ message: "git source operation failed within its transfer limits" }),
  );
test("an exhausted non-tip ancestry proof suggests a ref tip within its metadata budget", async () => {
  const result = await Effect.runPromise(
    verifyCommit(
      git,
      "https://github.com/owner/repo.git",
      { repo: "owner/repo", path: "", rev: "a".repeat(40) },
      new Map([["refs/heads/main", "b".repeat(40)]]),
      "/unused",
    ).pipe(Effect.result),
  );
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result))
    expect(result.failure.message).toContain(
      "32 MiB ancestry budget; pin a branch or tag tip instead",
    );
});
