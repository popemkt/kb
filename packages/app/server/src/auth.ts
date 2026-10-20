/**
 * Who a request to the `kb ui` server comes from: the person, or nobody the
 * server can vouch for (`DESIGN.md` → Surfaces → Who the person is). This is
 * the one input the app takes from authentication. How a deployment
 * authenticates the person is its own choice, made by which
 * {@link Authenticator} it starts the server with; what a connection may do
 * then follows from the answer alone (`guard.ts`), never from how it was
 * found.
 */
import { timingSafeEqual } from "node:crypto";
import { userInfo } from "node:os";
import { PAGE_TOKEN_HEADER, offeredPageToken, type Person } from "@kb/contracts";

/**
 * What an authenticator makes of a request: the person's, nobody's
 * (`person: null`), or refused, when it presents a credential that is not
 * good here and so must not quietly be taken as nobody's.
 */
type Identification = { readonly person: Person | null } | { readonly refused: string };

/** How a deployment authenticates the person. */
export interface Authenticator {
  readonly identify: (req: Request) => Identification;
}

const NOBODY: Identification = { person: null };

/** A page token: 32 random bytes, in hex. */
export function mintPageToken(): string {
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
 * The local `kb ui`'s authentication: the page token this run minted. Only
 * the person who started the server holds it (from the URL it opened or
 * printed, or their home), so a request carrying it is theirs, under their
 * account's name. One carrying another token (forged, or from an earlier
 * run) is refused, and one carrying none is nobody's.
 */
export function pageTokenAuthenticator(
  token: string,
  person: Person = { name: userInfo().username },
): Authenticator {
  return {
    identify: (req) => {
      const presented = presentedToken(req);
      if (presented === null) return NOBODY;
      if (!sameToken(presented, token)) {
        return {
          refused:
            "this page's token is not this kb ui's (it is from an earlier run): open the page again from the URL kb ui printed, or with kb open",
        };
      }
      return { person };
    },
  };
}

/**
 * A hosted `kb ui`'s authentication: the person's login, in a header a
 * trusted reverse proxy sets on every request it forwards (Tailscale serve's
 * `Tailscale-User-Login`, which it also strips from what a client sends). A
 * request whose header names one of `people` is theirs, under that login;
 * any other is nobody's. Every program that reaches the server's port can
 * send the header, so the deployment opts in only where the proxy is the
 * one way in (`DESIGN.md` → Surfaces → Who the person is).
 */
// GAP [[01M5BVQHJEDC4ZK7BX7RZWDVF8]]
export interface IdentityHeader {
  /** The header the proxy names the person in. */
  readonly header: string;
  /** The logins that are the person. */
  readonly people: readonly string[];
}

export function identityHeaderAuthenticator({ header, people }: IdentityHeader): Authenticator {
  const known = new Set(people);
  return {
    identify: (req) => {
      const login = req.headers.get(header);
      return login !== null && known.has(login) ? { person: { name: login } } : NOBODY;
    },
  };
}

/**
 * A deployment that authenticates the person in more than one way: a
 * request any of them refuses is refused, and one any of them finds is the
 * person's is theirs, as the first that found it names them.
 */
export function anyAuthenticator(authenticators: readonly Authenticator[]): Authenticator {
  return {
    identify: (req) => {
      const answers = authenticators.map((auth) => auth.identify(req));
      const refused = answers.find((answer) => "refused" in answer);
      if (refused !== undefined) return refused;
      return answers.find((answer) => "person" in answer && answer.person !== null) ?? NOBODY;
    },
  };
}

/**
 * How a `kb ui` authenticates the person: its page token, and its proxy's
 * identity header where the deployment trusts one.
 */
export function uiAuthenticator(
  token: string,
  identityHeader: IdentityHeader | undefined,
): Authenticator {
  const byToken = pageTokenAuthenticator(token);
  if (identityHeader === undefined) return byToken;
  return anyAuthenticator([byToken, identityHeaderAuthenticator(identityHeader)]);
}
