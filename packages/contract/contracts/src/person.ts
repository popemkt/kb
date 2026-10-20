import { z } from "zod";

/**
 * The person: the one who owns this kb, as the deployment's authentication
 * names them (`DESIGN.md` → Surfaces → Who the person is). A connection is
 * theirs, or nobody's the server can vouch for; what it may do follows from
 * which (`PAGE_WIRE`, `HTTP_WIRE`).
 */
export const PersonSchema = z.object({
  /** How the authentication names them: a local account, or a login a trusted proxy vouched for. */
  name: z.string().min(1),
});
export type Person = z.infer<typeof PersonSchema>;
