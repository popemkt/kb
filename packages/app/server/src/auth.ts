/**
 * Who the person behind the `kb ui` page is (`DESIGN.md` → Surfaces → Who
 * the person is). Whether a request is the page's is the request guard's
 * (`guard.ts`, by its Origin); what name the page goes by is this module's.
 * Plugins supply it: each identity provider a deployment loads contributes
 * to {@link IdentityPoint}, and the server combines their answers
 * ({@link identifyBy}); with none, the page is the server's owner
 * ({@link serverOwner}). The provider kb ships is here: a hosted one's
 * trusted proxy header.
 */
import { userInfo } from "node:os";
import { Effect } from "effect";
import {
  IdentityPoint,
  type Identification,
  type IdentityProvider,
  type Person,
} from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";

const NOBODY: Identification = { person: null };

/**
 * What a request is: the first provider's answer, in order, and nobody's
 * when every one passes, as it is when there is no provider at all.
 */
export function identifyBy(providers: readonly IdentityProvider[], req: Request): Identification {
  for (const provider of providers) {
    const answer = provider.identify(req);
    if (answer !== null) return answer;
  }
  return NOBODY;
}

/**
 * The person a page is when no provider names them: the account that runs
 * the server, whose kb it serves.
 */
export function serverOwner(): Person {
  return { name: userInfo().username };
}

/**
 * The header a trusted reverse proxy names the person in, and the logins
 * that are them.
 */
export interface IdentityHeader {
  /** The header the proxy names the person in. */
  readonly header: string;
  /** The logins that are the person. */
  readonly people: readonly string[];
}

/**
 * A hosted `kb ui`'s identity provider: the person's login, in a header a
 * trusted reverse proxy sets on every request it forwards (Tailscale serve's
 * `Tailscale-User-Login`, which it also strips from what a client sends). A
 * request whose header names one of `people` is theirs, under that login;
 * on any other it passes. Every program that reaches the server can send
 * the header, so it is believed only where the proxy is the one way in:
 * `kb ui` loads it only on a socket its owner alone can connect to
 * (`--socket`, `listener.ts`; `DESIGN.md` → Action registry → Hosted behind a
 * proxy).
 */
export function identityHeaderIdentity({ header, people }: IdentityHeader): Plugin {
  const known = new Set(people);
  const provider: IdentityProvider = {
    identify: (req) => {
      const login = req.headers.get(header);
      return login !== null && known.has(login) ? { person: { name: login } } : null;
    },
  };
  return definePlugin({
    name: "identity-header",
    tags: ["identity"],
    namespace: "identity",
    apply: (plugin) =>
      plugin.contribute(IdentityPoint, { id: "header", value: provider }).pipe(Effect.asVoid),
  });
}
