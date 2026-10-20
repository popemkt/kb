import { z } from "zod";
import { Point } from "@kb/plugin";

/**
 * The person: the one who owns this kb, as an identity provider names them
 * (`DESIGN.md` → Surfaces → Who the person is). A connection is theirs, or
 * nobody's the server can vouch for; what it may do follows from which
 * (`PAGE_WIRE`, `HTTP_WIRE`).
 */
export const PersonSchema = z.object({
  /** How the provider names them: a local account, or a login a trusted proxy vouched for. */
  name: z.string().min(1),
});
export type Person = z.infer<typeof PersonSchema>;

/**
 * What one identity provider answers about a request: it is the person's,
 * or it is refused, because it presents a credential that is not good here
 * and so must not quietly be taken as nobody's.
 */
export type IdentityAnswer = { readonly person: Person } | { readonly refused: string };

/** Who a request is, all providers asked: an answer, or nobody's (`person: null`) when every one passed. */
export type Identification = IdentityAnswer | { readonly person: null };

/**
 * One way a deployment authenticates the person. It answers about a request
 * it can vouch for or refuse, and passes (`null`) on any other.
 */
export interface IdentityProvider {
  readonly identify: (req: Request) => IdentityAnswer | null;
}

/**
 * The identity providers a `kb ui` server's plugins contribute. The server
 * asks them about each request in the kernel's order (each plugin's
 * dependencies first, then load order) and takes the first answer (Cordis's
 * `bail`); when every one passes, or there is none, the request is nobody's.
 */
export const IdentityPoint = Point<IdentityProvider>()("identity.providers");
