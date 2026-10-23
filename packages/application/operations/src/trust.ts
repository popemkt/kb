/**
 * Trusting code (DESIGN.md → Sandbox → Trust): a person says that the code
 * with this digest, the digest of exactly what their UI showed and ran, may
 * run in a Worker on this machine. Trust is local state behind the
 * `CodeTrust` port, never a node.
 *
 * `sandbox.trust` declares that each call needs a person's approval, which a
 * guard may read; none that ships does for now, so an agent's call trusts
 * as a person's does (DESIGN.md → Sandbox → Trust,
 * GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]). Sandboxed code cannot call it: the
 * action declares no `targets`, so no grant reaches it. Dropping trust is
 * always safe, so `sandbox.untrust` declares nothing.
 */
import { Effect } from "effect";
import { z } from "zod";
import { CodeTrust, type ActionDefinition } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { isCodeDigest } from "@kb/sandbox";

const Digest = z.string().refine(isCodeDigest, "a code digest: sha256: followed by 64 hex digits");

export const sandboxTrustDef = {
  id: "sandbox.trust",
  title: "Trust code",
  description:
    "Trust, on this machine, by the digest of exactly what it covers: sandboxed code and its grant (it then runs in a Worker instead of QuickJS), a repository extension's source (it then runs with the server's reach, and so does what it loads or evaluates when it runs), or an agent provider's binding (the key it sends, the endpoint it sends it to, the executable it starts). Meant as a person's own gesture: it declares approval, which no guard that ships enforces for now. It is never written to the graph.",
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
