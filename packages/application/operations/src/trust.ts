/**
 * Trusting code (DESIGN.md → Sandbox → Trust): a person says that the code
 * with this digest, the digest of exactly what their UI showed and ran, may
 * run in a Worker on this machine. Trust is local state behind the
 * `CodeTrust` port, never a node.
 *
 * Required approval is enforced by core. Legacy review grants no authority;
 * importing an explicit reviewed digest list requires the same approval.
 */
import { Effect } from "effect";
import { z } from "zod";
import { CodeTrust, LegacyTrust, type ActionDefinition } from "@kb/contracts";
import { domainError, type DomainError } from "@kb/model";
import { isCodeDigest } from "@kb/sandbox";

const Digest = z.string().refine(isCodeDigest, "a code digest: sha256: followed by 64 hex digits");

export const sandboxTrustDef = {
  id: "sandbox.trust",
  title: "Trust code",
  description:
    "Trust, on this machine, by the digest of exactly what it covers: sandboxed code and its grant (it then runs in a Worker instead of QuickJS), a repository extension's source (it then runs with the server's reach, and so does what it loads or evaluates when it runs), or an agent provider's binding (the key it sends, the endpoint it sends it to, the executable it starts). Declared required approval is enforced by the invoke core in every deployment. It is never written to the graph.",
  mode: { kind: "write", approval: "required" } as const,
  inputSchema: z.object({ digest: Digest }),
  outputSchema: z.object({ digest: z.string(), trusted: z.literal(true) }),
} satisfies ActionDefinition;

export const sandboxUntrustDef = {
  id: "sandbox.untrust",
  title: "Stop trusting code",
  description:
    "Stop trusting code on this machine, by its digest: sandboxed code runs in QuickJS again, and a repository extension is not loaded, from the next load on.",
  mode: { kind: "write" } as const,
  inputSchema: z.object({ digest: Digest }),
  outputSchema: z.object({ digest: z.string(), trusted: z.literal(false) }),
} satisfies ActionDefinition;

export const sandboxTrustedDef = {
  id: "sandbox.trusted",
  title: "Trusted code",
  description: "Which of these code digests a person has trusted on this machine.",
  mode: { kind: "read" } as const,
  inputSchema: z.object({ digests: z.array(Digest).max(100) }),
  outputSchema: z.object({ trusted: z.array(z.string()) }),
} satisfies ActionDefinition;

export const sandboxTrustEffect = Effect.fn("sandbox.trust")(function* (
  input: z.infer<typeof sandboxTrustDef.inputSchema>,
): Effect.fn.Return<z.infer<typeof sandboxTrustDef.outputSchema>, DomainError, CodeTrust> {
  yield* (yield* CodeTrust).trust(input.digest);
  return { digest: input.digest, trusted: true };
});

export const sandboxUntrustEffect = Effect.fn("sandbox.untrust")(function* (
  input: z.infer<typeof sandboxUntrustDef.inputSchema>,
): Effect.fn.Return<z.infer<typeof sandboxUntrustDef.outputSchema>, DomainError, CodeTrust> {
  yield* (yield* CodeTrust).untrust(input.digest);
  return { digest: input.digest, trusted: false };
});

export const sandboxTrustedEffect = Effect.fn("sandbox.trusted")(function* (
  input: z.infer<typeof sandboxTrustedDef.inputSchema>,
): Effect.fn.Return<z.infer<typeof sandboxTrustedDef.outputSchema>, DomainError, CodeTrust> {
  return { trusted: [...(yield* (yield* CodeTrust).trusted(input.digests))] };
});

export const sandboxImportLegacyDef = {
  id: "sandbox.trust.import",
  title: "Import reviewed legacy trust digests",
  description:
    "Trust only the explicit reviewed digests from this machine's legacy file, after a person's approval. Rechecks membership and never changes or deletes the legacy file or other machines' records.",
  mode: { kind: "write", approval: "required", outsideRoot: true } as const,
  inputSchema: z.object({ root: z.string().min(1), digests: z.array(Digest).max(1000) }),
  outputSchema: z.object({ imported: z.array(Digest) }),
} satisfies ActionDefinition;
export const sandboxImportLegacyEffect = Effect.fn("sandbox.trust.import")(function* (
  input: z.infer<typeof sandboxImportLegacyDef.inputSchema>,
) {
  const legacy = new Set(yield* (yield* LegacyTrust).digests(input.root));
  const imported = [...new Set(input.digests)];
  if (imported.some((digest) => !legacy.has(digest)))
    return yield* domainError(
      "invalid_input",
      "review legacy trust again: requested digests are not this machine's legacy records",
    );
  const trust = yield* CodeTrust;
  for (const digest of imported) yield* trust.trust(digest);
  return { imported };
});
