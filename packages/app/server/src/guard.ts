/**
 * Who may reach the `kb ui` server's API, and on whose wire it calls: the
 * one request guard, applied to the `/ws` upgrade and every `/api/*` route
 * before anything else runs (`DESIGN.md` → Surfaces → Who the person is).
 *
 * The server listens on loopback, but a web page in the same browser can
 * still send it requests, so loopback alone does not keep other sites out.
 * Three checks do:
 *
 * - **Host** must name this server (`127.0.0.1:<port>`, `localhost:<port>`,
 *   or the host it was bound to; `localhost` for a socket, as its proxy
 *   names it; the public origin's host behind a proxy). A page on another
 *   site that rebinds its own DNS name to 127.0.0.1 sends its own name
 *   here, so this is what stops DNS rebinding.
 * - **Origin**, when there is one, must be the UI's own. A browser always
 *   sends it on a cross-origin request and on every WebSocket handshake. A
 *   local program (the CLI, `kb mcp`, curl) sends none and is let through.
 * - **`POST /api/action`** must be `application/json`. A page may send a
 *   form or `text/plain` POST to any origin without a preflight; JSON needs
 *   one, which the Origin check then refuses.
 *
 * A request that passes them and carries the UI's Origin is the page's: a
 * browser sets Origin on every request a page makes but a same-origin GET,
 * and no site but the UI's gets past the Origin check. It is on the page's
 * wire, the person's, under the name the deployment's identity providers
 * give them (`auth.ts`), or the server's owner's when none does; a provider
 * that refuses a request refuses it. Any other request is a local
 * program's, an agent's. A local program may send the UI's Origin too, and
 * then passes as the page: kb's actors are a record of who made a call, not
 * a security boundary, which is who can reach the server at all (the
 * machine's accounts, a tailnet's grants; DESIGN.md → Surfaces → Who the
 * person is). The same holds on every deployment, a TCP port, a proxy or a
 * socket.
 */
import {
  PAGE_WIRE,
  type Identification,
  type Person,
  type SurfaceWire,
  type UiListener,
} from "@kb/contracts";

/**
 * HTTP's wire for a local program: a request that carries no Origin (the
 * CLI's relay, curl, another app). Its calls are an agent's, and it cannot
 * say a person approved one. The page's requests are the page's wire
 * (`PAGE_WIRE`).
 */
export const HTTP_WIRE: SurfaceWire = { carriesApproval: false, actor: "agent" };

/** Where the server listens, and where the browser loads the UI from. */
export interface GuardSite {
  /** Where the server listens. */
  readonly at: UiListener;
  /**
   * The port the UI page is served from, when another server serves it (the
   * Vite dev server's). Default: the TCP listener's own.
   */
  readonly uiPort?: number;
  /** Browser origin when a reverse proxy serves this UI. */
  readonly publicOrigin?: string;
  /** Who a request is, by every identity provider the server holds (`identifyBy`). */
  readonly identify: (req: Request) => Identification;
  /** Who the page is when no provider names them (`serverOwner`). */
  readonly owner: Person;
}

/**
 * Who a request the guard lets through comes from: the page, which is the
 * person, or a local program, which is nobody (`null`), and its wire.
 */
export interface Caller {
  readonly wire: SurfaceWire;
  readonly person: Person | null;
}

/** A local program's request: nobody's, on HTTP's wire. */
export const PROGRAM: Caller = { wire: HTTP_WIRE, person: null };

/** What the guard makes of a request: refused, or let through from its caller. */
type Admission = { readonly refused: Response } | { readonly caller: Caller };

export interface RequestGuard {
  readonly admit: (req: Request, url: URL) => Admission;
}

const LOOPBACK_NAMES = ["127.0.0.1", "localhost"];

function refusal(status: number, message: string): Response {
  return Response.json({ status: "failed", id: "unknown", code: "forbidden", message }, { status });
}

function isJson(contentType: string | null): boolean {
  const media = contentType?.split(";")[0]?.trim().toLowerCase();
  return media === "application/json";
}

/**
 * The origins a browser may load the UI from, and the hosts a request may
 * name, as `requestGuard` admits them. A TCP listener answers to each name
 * it is reached by, on its own port and the UI's, and a page loaded from
 * any of them is the UI's. A socket is reached through its proxy alone,
 * which names it `localhost` (`tailscale serve` rewrites `Host` so for a
 * `unix:` target), and its page is the proxy's public origin. A public
 * origin is a host too.
 */
function addressesOf(site: GuardSite): { origins: Set<string>; hosts: Set<string> } {
  const { at } = site;
  const own =
    at.kind === "tcp"
      ? {
          origins: [...new Set([...LOOPBACK_NAMES, at.hostname])].flatMap((name) =>
            [at.port, site.uiPort ?? at.port].map((port) => `http://${name}:${port}`),
          ),
          hosts: [],
        }
      : { origins: [at.origin], hosts: ["localhost"] };
  const origins = new Set(own.origins);
  if (site.publicOrigin !== undefined) origins.add(new URL(site.publicOrigin).origin);
  const hosts = new Set([...own.hosts, ...[...origins].map((origin) => new URL(origin).host)]);
  return { origins, hosts };
}

/** The page's request, as `person`. */
function page(person: Person): Admission {
  return { caller: { wire: PAGE_WIRE, person } };
}

export function requestGuard(site: GuardSite): RequestGuard {
  const { origins, hosts } = addressesOf(site);
  const refused = (status: number, message: string): Admission => ({
    refused: refusal(status, message),
  });
  return {
    admit: (req, url) => {
      if (url.pathname !== "/ws" && !url.pathname.startsWith("/api/")) return { caller: PROGRAM };
      const host = req.headers.get("host");
      if (host === null || !hosts.has(host)) {
        return refused(403, `host ${host ?? "(none)"} is not this kb ui`);
      }
      const origin = req.headers.get("origin");
      if (origin !== null && !origins.has(origin)) {
        return refused(403, `origin ${origin} is not this kb ui`);
      }
      if (
        url.pathname === "/api/action" &&
        req.method === "POST" &&
        !isJson(req.headers.get("content-type"))
      ) {
        return refused(415, "POST /api/action takes application/json");
      }
      const identified = site.identify(req);
      if ("refused" in identified) return refused(403, identified.refused);
      if (origin === null) return { caller: PROGRAM };
      return page(identified.person ?? site.owner);
    },
  };
}
