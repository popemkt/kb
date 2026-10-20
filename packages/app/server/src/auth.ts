/**
 * Who a request to the `kb ui` server comes from: the person, or nobody the
 * server can vouch for (`DESIGN.md` → Surfaces → Who the person is). This is
 * the one input the app takes from authentication, and plugins supply it:
 * each identity provider a deployment loads contributes to
 * {@link IdentityPoint}, and the server combines their answers
 * ({@link identifyBy}). What a connection may do then follows from the
 * answer alone (`guard.ts`), never from which provider gave it. The two
 * providers kb ships are here: the local `kb ui`'s page token, and a hosted
 * one's trusted proxy header.
 */
import { timingSafeEqual } from "node:crypto";
import { userInfo } from "node:os";
import { Effect } from "effect";
import {
  IdentityPoint,
  PAGE_TOKEN_HEADER,
  offeredPageToken,
  type Identification,
  type IdentityProvider,
  type Person,
} from "@kb/contracts";
import { Service, definePlugin, type Plugin } from "@kb/plugin";

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
 * The page token the page-token provider holds, for the server that opens
 * the person's page: it puts the token in the page URL it opens and prints,
 * and keeps it in the person's home for openers in other processes.
 */
export const PageToken = Service<string>()("kb.ui.page-token");

/** A page token: 32 random bytes, in hex. */
function mintPageToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
}

/** The page token a request presents: in its header, or offered on its WebSocket handshake. */
function presentedToken(req: Request): string | null {
  return (
    req.headers.get(PAGE_TOKEN_HEADER) ??
    offeredPageToken(req.headers.get("sec-websocket-protocol"))
  );
}

/** Whether `presented` is `token`, compared in time that does not depend on where they differ. */
function sameToken(presented: string, token: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The local `kb ui`'s identity provider: a page token minted when it
 * starts. Only the person who started the server holds it (from the URL it
 * opened or printed, or their home), so a request carrying it is theirs,
 * under their account's name. One carrying another token (forged, or from
 * an earlier run) is refused, and on one carrying none it passes.
 */
export function pageTokenIdentity(
  token: string = mintPageToken(),
  person: Person = { name: userInfo().username },
): Plugin {
  const provider: IdentityProvider = {
    identify: (req) => {
      const presented = presentedToken(req);
      if (presented === null) return null;
      if (!sameToken(presented, token)) {
        return {
          refused:
            "this page's token is not this kb ui's (it is from an earlier run): open the page again from the URL kb ui printed, or with kb open",
        };
      }
      return { person };
    },
  };
  return definePlugin({
    name: "identity-page-token",
    namespace: "identity",
    apply: (plugin) =>
      Effect.gen(function* () {
        yield* plugin.provide(PageToken, token);
        yield* plugin.contribute(IdentityPoint, { id: "page-token", value: provider });
      }),
  });
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
 * on any other it passes. Every program that reaches the server's port can
 * send the header, so the deployment opts in only where the proxy is the
 * one way in (`DESIGN.md` → Surfaces → Who the person is).
 */
// GAP [[01M5BVQHJEDC4ZK7BX7RZWDVF8]]
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
    namespace: "identity",
    apply: (plugin) =>
      plugin.contribute(IdentityPoint, { id: "header", value: provider }).pipe(Effect.asVoid),
  });
}
