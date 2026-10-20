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
 * What an identity provider makes of a request: the person's, nobody's
 * (`person: null`), or refused, when it presents a credential that is not
 * good here and so must not quietly be taken as nobody's.
 */
export type Identification = { readonly person: Person | null } | { readonly refused: string };

/** One way a deployment authenticates the person. */
export interface IdentityProvider {
  readonly identify: (req: Request) => Identification;
}

/**
 * The identity providers a `kb ui` server's plugins contribute. The server
 * asks every one of them about each request and takes the person from their
 * answers alone; with none contributed, every connection is nobody's.
 */
export const IdentityPoint = Point<IdentityProvider>()("kb.ui.identity");
