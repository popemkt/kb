# kb's MCP on the public internet, for its owner only, with Google sign-in

Research record and design proposal, 2026-11-24, based on kb at `6676cb47`
and the dotfiles repository (popemkt/mac-backup) as checked out on
shared-server. No product code. Sources were read on 2026-11-24. Anything
not seen in a source is marked *(unverified)* and listed in §7. Revised twice;
see the Addendum.

## 0. Recommendation

- **kb does not know about access.** Its one change is generic: `kb mcp --listen <unix socket | loopback port>` serves the same MCP over Streamable HTTP. The tools and resources are the ones stdio MCP and the agent extension's callers see, read and write, with no cap and no token check.
- **All access control sits at the edge, declared in dotfiles:**

  ```
  Tailscale Funnel ($0) → oauth2-proxy → kb's socket
                              ↕
                             Dex ↔ Google
  ```

  - Dex is a small OpenID provider. It issues tokens only to pre-registered clients that hold a secret: one for Gemini, one for Claude.
  - oauth2-proxy lets a request through only with a valid Dex token for the owner's Google address.
  - Only the routes the sign-in flow needs are reachable from the internet.
  - Both are single Go binaries with NixOS modules: the least to run of everything compared (§3).
- **Why "only my Google account may sign in" is not enough.** Anyone can add your kb URL as a connector in *their own* Gemini or Claude account. That starts a sign-in, and they send you the link. You sign in as yourself, so the account check passes, and the vendor delivers the result to their connector, not yours: they now hold a token for your kb. The vendors use one callback address for every user, so no redirect check can tell their connector from yours. **The client secret closes this.** Only the connector you set up has it, typed into Gemini's Client ID / Client secret fields. Without it the attacker's connector cannot exchange the sign-in result for a token.
- **Isolation is infra only.** The exposed kb runs in a systemd sandbox. It has no network, and the only part of the filesystem it sees is the personal store, read-write. kb-work is on another machine, and the sandbox cannot reach it.
- **Phase 1:** paste the URL, client id and secret into Gemini, sign in with Google, and every kb tool works.

## 1. The clients

All three call from the vendor's cloud, so the URL must be public.

| | Gemini web (Developer Mode) | claude.ai custom connector | ChatGPT |
|---|---|---|---|
| Transport | Streamable HTTP only, no SSE [G4] | Streamable HTTP; `/sse` URL for SSE [C1] | SSE and Streamable HTTP [O2] |
| Pre-registered client with secret | **Yes. "Additional settings": Client ID and Client secret** (owner confirmed in the dialog; [G1][G2]) | Yes, "Use your own OAuth client" [C1] | "Predefined OAuth clients" listed; whether it takes a secret is *unverified* [O1] |
| Discovery | AS metadata (RFC 8414 / OIDC well-known) on the server origin; PRM not mentioned [G3] | PRM (RFC 9728) via a 401 `WWW-Authenticate`, probing as fallback [C2] | PRM or the 401 header [O1] |
| Calls come from | Google's backend, published CIDRs, port 443 [G4][G5] | Anthropic, 160.79.104.0/21 and 153.61.208.0/20, port 443 [C3][C4] | OpenAI, published list, mTLS cert [O1][O3] |
| OAuth redirect | `https://oauth-redirect.googleusercontent.com/r/*` (pattern) [G3] | `https://claude.ai/api/mcp/auth_callback` [C2] | `https://chatgpt.com/connector_platform_oauth_redirect` [O1] |
| PKCE | S256 [G3] | S256 [C2] | S256 [O1] |
| Plan | Custom apps: 18+, US, personal account [G1] | All plans; Free gets one connector [C1] | Write MCP: Business, Enterprise/Edu; Pro is read/fetch [O4] |

Google's own OAuth cannot be the authorization server here: it has no client
registration, and it cannot register Gemini's wildcard redirect. So a broker
issues the tokens and uses Google only to sign in.

## 2. kb today

- **MCP is stdio only.** `kb mcp` connects a `StdioServerTransport` (`packages/app/mcp/src/mcp.ts:391-405`). `createMcpServer` binds no transport (`mcp.ts:253-272`), so adding a second one is local. The pinned SDK, 1.30.0, ships `server/webStandardStreamableHttp.js` (Request/Response, fits `Bun.serve`; checked in the Bun cache).
- **Every tool is a registry action** on `MCP_WIRE` (`actor: "agent"`, no approval; `mcp.ts:86-92`). Resources are the views (`mcp.ts:209-235`).
- **Writes are attributed by `KB_VIA`.** A transaction records `actor`, `session` and `via`, and `via` comes from the process environment (`packages/app/runtime/src/process-via.ts:10`). The edge sets `KB_VIA=mcp-remote` on the unit, so kb learns where calls come from without knowing anything about access.
- **One parity limit is the same as on stdio.** Actions that need a person's approval (restore, migrations, trust, script runs) are refused over any MCP, because MCP carries no approval (gap `01M3R2KD6V1AZ9WS62ZVG9T4G2`). The agent sidebar asks the person; MCP cannot until elicitation lands. Nothing here makes that worse.
- **Socket precedent.** `kb ui --socket` already listens on a Unix socket created with mode 0600 under a matching umask (`packages/app/server/src/listener.ts`). `kb mcp --listen unix:…` reuses it, so only the socket's account (and root) can connect.
- **What is no longer proposed.** kb's identity providers (`IdentityPoint`), grants and capture tokens stay as they are; this design touches none of them. Gap `01M413SP3QSSQJMKKDK3W3J6G8` stays open; the edge, not kb, authenticates this surface.

**On shared-server** (dotfiles):

- `my.stacks.kb.stores` turns each store into a unit running as its owner, on `/run/kb-<owner>/kb.sock`, published as `svc:kb-<owner>` (`modules/stacks/kb/nixos.nix:26-62`). The personal store's root is in `popemkt`'s home (`:113`).
- kb-work runs on the work Mac (`hosts/popemkt-work/default.nix:30-54`), but shared-server can reach it: `configs/tailscale/policy.hujson:78-82`, plus a wildcard grant at `:133-137`. Tailnet reach is per machine, so the sandbox must have no network.
- There is no Funnel yet (no `nodeAttrs`; tailscaled 1.102.4).
- Secrets are machine-state files (`hosts/shared-server/default.nix:313-332`).

## 3. Broker choice

The edge needs to:

- (a) let only the owner's Google account through;
- (b) issue tokens only to pre-registered clients that hold a secret, with exact redirects;
- (c) serve the discovery metadata the clients read;
- (d) check the token on every `/mcp` request and forward to a Unix socket;

and, from the review, expose only the sign-in routes.

| Option | (a) | (b) | (c) | (d) | What runs | Verdict |
|---|---|---|---|---|---|---|
| **Dex + oauth2-proxy** | oauth2-proxy `--authenticated-emails-file`. It applies to bearer tokens too, and a token without an email falls back to its subject, which fails the list (`oauthproxy.go:1191`, `providers/oidc.go:224-226`) | Dex `staticClients` with secrets. Redirects must match exactly (`server/authflow/request.go:88-98`). Approval screen | Dex serves OIDC discovery. Static PRM and RFC 8414 files are served by oauth2-proxy `file://` upstreams | `--skip-jwt-bearer-tokens` with `--extra-jwt-issuers <dex>=<client id>`; `--api-route` gives a 401, not a redirect; `unix://` upstream | Two Go binaries, `services.dex` (SQLite) and `services.oauth2-proxy` | **Recommended** |
| Keycloak + oauth2-proxy | Native: registration off, only the linked user | Confidential clients; a trailing `*` redirect is allowed | Native | Still needs oauth2-proxy, since kb checks nothing | JVM + PostgreSQL + oauth2-proxy. The Admin API and master realm must be fenced off (expose only `/realms/<r>/` login, discovery and `/resources/`) | Fallback if Gemini's redirect is not one fixed URL |
| Pomerium 0.34.1 (latest) | Yes | **No.** DCR can be turned off (`internal/mcp/handler_register_client.go:38`), but then clients come only from CIMD, which admits public clients (no secret) only (`handler_authorization.go:25`). No static clients, no consent | Yes | Yes | One binary | **Fails (b)** |
| sigbit/mcp-auth-proxy 2.11.0 | Google with an allowed-users list | **No.** Open DCR only (`/.idp/register`). Its consent page shows the redirect, which for this attack is the vendor's real callback | Yes | Yes | One binary, not in nixpkgs *(unverified)* | **Fails (b)** |
| Authelia | **No** upstream Google sign-in | Static confidential clients, consent | Yes | Needs a proxy | | Fails (a) |
| Cloudflare Access | Yes | DCR with a redirect allow-list, which fails the shared-callback attack. Static clients *unverified* | Yes | Yes | A Cloudflare account and **a domain (~$10/yr, a paid item)**. Cloudflare sees content | No |

**The one risk in Dex:** Google publishes Gemini's redirect only as a
pattern (`/r/*`). Dex needs the exact URL. Dex rejects an unregistered
redirect and names it in the error *(unverified that it names it)*, so the
first sign-in attempt reveals the URL, and the owner pins it in dotfiles. If
it changes per connection, switch to Keycloak (§6, decision 1).

## 4. Architecture

```
 Gemini / Claude backends                         owner's browser (sign-in)
            │ HTTPS :443  https://<node>.<tailnet>.ts.net                │
            ▼                                                            ▼
     Tailscale Funnel relay (TCP passthrough; TLS ends on shared-server)
            │
 ┌─ shared-server ─────────────────────────────────────────────────────────────┐
 │ tailscaled: funnel 443 → http://127.0.0.1:4180  (one mount: oauth2-proxy)    │
 │                                                                             │
 │ oauth2-proxy (sandboxed; loopback only) — the single table of exposed routes:│
 │   /mcp                                    auth: Dex JWT + owner email → unix │
 │                                           socket of kb (api-route: 401)      │
 │   /.well-known/oauth-protected-resource   static file (PRM → issuer)         │
 │   /.well-known/oauth-authorization-server static file (Dex's metadata)       │
 │   /.well-known/openid-configuration, /auth, /auth/google, /callback,         │
 │   /approval, /token, /keys, /static/, /theme/      → Dex 127.0.0.1:5556       │
 │   anything else                            404                               │
 │                                                                             │
 │ Dex (issuer https://<host>, SQLite, gRPC API off, telemetry on loopback)     │
 │   connector: Google; staticClients: gemini, claude (secrets from files),     │
 │   exact redirects; approval screen on                                        │
 │                                                                             │
 │ kb-remote (sandbox; PrivateNetwork; sees only the personal store, rw)        │
 │   KB_VIA=mcp-remote kb --root <personal root> mcp                            │
 │                      --listen unix:/run/kb-remote/mcp.sock   (mode 0600)     │
 └─────────────────────────────────────────────────────────────────────────────┘
```

**Isolation, pure infra.** kb-remote and oauth2-proxy run as one account,
so the 0600 socket admits only that account and root. "Bypassing the proxy"
is then impossible without root.

**Recommended: the owner's account, sandboxed.** No ownership change on the
store, which `app-kb` keeps writing:

- `ProtectHome=tmpfs` with `BindPaths=<personal root>`, so the rest of the home is invisible;
- `InaccessiblePaths=/run/kb-* /run/user /run/tailscale`;
- `NoNewPrivileges=yes`, so `sudo` cannot escalate;
- `CapabilityBoundingSet=` empty, `PrivateTmp`, and `KB_DATA` in a private state directory (no host secrets or installed extensions);
- for kb: `PrivateNetwork=yes`, `RestrictAddressFamilies=AF_UNIX`;
- for oauth2-proxy: `IPAddressAllow=localhost`, `IPAddressDeny=any`.

**Alternative: a dedicated account.** It is cleaner, but two accounts then
write one store, which needs a shared group, setgid directories and default
ACLs (decision 2). Either way, kb is unaware of it.

**Request flow (phase 1, Gemini):**

1. Gemini → Connect to an MCP server: URL `https://<host>/mcp`; Client ID `gemini`; Client secret from the machine-state file.
2. Gemini's backend reads `/.well-known/oauth-authorization-server` (or `openid-configuration`) on the origin. Both describe Dex: issuer `https://<host>`, PKCE S256, `client_secret_post`/`client_secret_basic`, no registration endpoint.
3. The browser goes to `/auth?client_id=gemini&redirect_uri=…` (PKCE). Dex checks that the redirect is gemini's pinned one, sends the browser to Google, and on return shows its approval screen ("Gemini wants…"). It then redirects with a code to Google's callback.
4. Gemini's backend posts the code **with the client secret** to `/token` and gets a Dex JWT (`aud=gemini`, `email`, short expiry) and a refresh token. An attacker's connector fails here.
5. `POST /mcp` with the bearer token. oauth2-proxy verifies the signature against Dex's keys, plus `iss`, `aud`, expiry, `email_verified` and the email allow-list. It forwards to kb's socket, which answers like stdio.
6. `tools/call node_add` commits, with `via: mcp-remote`.

## 5. Threats

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| 1 | Anyone calls `/mcp` | 401 without a valid Dex token for the owner's email | oauth2-proxy, Dex and tailscaled are internet-facing; keep them current |
| 2 | Another Google account signs in | Dex may issue it a token, but oauth2-proxy's email list refuses it. A token with no email is refused too | — |
| 3 | **Shared-callback phishing** (§0) | The client secret: the attacker's connector cannot redeem the code. The approval screen is a second, weak layer | A breach of the owner's Gemini or Claude account exposes the secret; rotate it in dotfiles |
| 4 | Admin, debug or unused broker routes | One route table in oauth2-proxy; everything else 404. Dex's gRPC API is off and telemetry is on loopback | — |
| 5 | Bypassing the proxy | kb's socket is 0600; only the proxy's account and root | Root (passwordless `wheel` on this box) |
| 6 | **kb-work or other stores leak** | Different machine. kb-remote has no network. The sandbox shows only the personal store; other stores' sockets are inaccessible. Phase 1b tests each denial | Location entries in the personal store are visible as data (names and paths), not openable |
| 7 | A vendor's stored token leaks, or prompt injection drives writes | Full read-write is the owner's choice. Short access tokens; revoke by deleting Dex's SQLite state or rotating a client secret. `graph.changes` shows every `mcp-remote` write; kb backups allow restore | Damage until revoked; anything read is disclosed to that vendor |
| 8 | Load | Funnel's bandwidth cap; `CPUQuota`/`MemoryMax` on kb-remote | Slower `app-kb` on the shared store |

## 6. Build plan and decisions

One PR per row; the kb PR lands first, then dotfiles pins it.

**1a — kb: `feat: MCP over Streamable HTTP`.**

- Change: `kb mcp --listen <unix:path | 127.0.0.1:port>`, stateless, no auth. It refuses a non-loopback TCP address. It is one more row in the surface contract (`packages/app/test-kit/src/surface-contract.ts`). Update DESIGN.md → Surfaces (MCP) and record the wire fingerprint.
- Accepts:
  - `tools/list` and `resources/list` over HTTP equal stdio's on the same store;
  - `tools/call` (a read and a write) and `resources/read` work;
  - the socket is created with mode 0600;
  - `--listen 0.0.0.0:…` is refused;
  - `GET /` → 404.

**1b — dotfiles: `feat: an OAuth edge for kb's MCP, tailnet only`.**

- Change: a `modules/stacks/mcp-edge` stack (Dex, oauth2-proxy, the route table, static metadata) and `my.stacks.kb.stores.<store>.remoteMcp = { enable; email; }`, which adds the sandboxed kb-remote unit. Secrets (Google client for Dex, the two client secrets, oauth2-proxy's cookie secret) go through `LoadCredential=`. It is published on the tailnet only (`tailscale serve`), not Funnel.
- Accepts:
  - **the phishing test:** a sign-in started with client `gemini` and redeemed with a wrong secret gets no token;
  - a second Google account → 403 at `/mcp`;
  - a token from another issuer → 401;
  - every path outside the route table → 404;
  - **denials, run inside the units** (`nsenter` as their user):
    - no TCP from kb-remote;
    - `svc:kb-work` is unreachable from both units;
    - `~/` beyond the store is empty;
    - `/run/kb-popemkt/kb.sock` and `/run/kb-bytetum` are inaccessible.

**1c — dotfiles: `feat: Funnel for kb's MCP`.**

- Change: `nodeAttrs: [{target: ["tag:shared-server"], attr: ["funnel"]}]` in `policy.hujson`, with `check-tailscale-policy.sh` requiring Funnel to be declared. A declared Funnel oneshot with an off switch.
- Accepts: from outside the tailnet, **the owner pastes URL, id and secret into Gemini, signs in, Gemini lists every kb tool, a search answers, and a `node_add` lands** (visible in `kb ui`, `via: mcp-remote`).

**2 — dotfiles: claude.ai.**

- Change: a `claude` static client.
- Accepts: Claude lists tools. Claude's 401 discovery works without a `WWW-Authenticate` header (probing fallback), or the edge adds one *(unverified that oauth2-proxy can)*.
- ChatGPT waits until its predefined client is shown to take a secret.

**Off switch.**

- Declared: `remoteMcp.enable = false`, or removing the Funnel declaration (the reconcile runs `tailscale funnel reset`), then rebuild.
- Immediate: `sudo tailscale funnel reset`, or stop the units.
- `app-kb` is untouched.

**Decisions for the owner:**

| # | Decision | Recommendation |
|---|---|---|
| 1 | Broker: Dex + oauth2-proxy, or Keycloak + oauth2-proxy | **Dex + oauth2-proxy**, the least to run. Switch to Keycloak (fenced to its login and discovery routes) only if Gemini's redirect URL is not fixed |
| 2 | Isolation: the owner's account in a sandbox, or a dedicated account | **Sandbox as the owner**: same protection from kb-work and other stores, no ownership change on a store `app-kb` also writes |
| 3 | Secrets: the machine-state file pattern, or adopt sops-nix now | **Existing pattern** via `LoadCredential=` |
| 4 | Drop the tailnet's wildcard grant (separate PR) | **Yes.** Not needed here (the sandbox has no network), but it makes the declared grants real |

## 7. Unverified

- **Gemini's exact redirect URL**, and whether it is stable per connection; Dex needs it exact. Which scopes Gemini requests; oauth2-proxy needs `email` in the token, else it fails closed.
- Whether Gemini discovers metadata at the origin root as assumed.
- Dex: that the error names the rejected redirect; access-token lifetime settings (`expiry.idTokens`) and refresh rotation for this flow.
- oauth2-proxy: whether a 401 on an `--api-route` can carry `WWW-Authenticate` (Claude's preferred discovery); serving PRM via a `file://` upstream at the exact path.
- Funnel: a single mount to a loopback port (verified for serve; assumed for Funnel); the bandwidth figure.
- That all three clients accept a stateless Streamable HTTP server.
- ChatGPT: whether predefined clients take a secret.
- How Google's terms treat content Gemini reads through a connector.

**Verified in source on 2026-11-24:**

- Pomerium v0.34.1: `internal/mcp/handler_register_client.go:38` (DCR off switch); `internal/mcp/handler_authorization.go:25` (CIMD auth `none` only), `:371` (clients from CIMD or DCR storage).
- sigbit/mcp-auth-proxy (main, v2.11.0): `pkg/idp/idp.go` (`/.idp/register`, consent page); `main.go` (no static-client flags).
- Dex: `server/authflow/request.go:88-98` (exact redirect match).
- oauth2-proxy v7.15.6:
  - `oauthproxy.go:1191` (email allow-list on every session);
  - `providers/oidc.go:224-226` (bearer token without email → its subject);
  - `pkg/upstream/proxy.go:48-52` (`file://`, `unix://`, static upstreams);
  - configuration docs (`--skip-jwt-bearer-tokens`, `--extra-jwt-issuers`, `--api-route`, `--authenticated-emails-file`).

**Sources.**

Gemini:
- [G1] support.google.com/gemini/answer/17209137
- [G2] developers.google.com/connected-apps/mcp/dev-mode/usage
- [G3] developers.google.com/connected-apps/mcp/oauth
- [G4] developers.google.com/connected-apps/mcp/server-optimization
- [G5] developers.google.com/connected-apps/mcp/mcp-flow

Claude:
- [C1] claude.com/docs/connectors/custom/add-unlisted
- [C2] claude.com/docs/connectors/building/authentication
- [C3] support.claude.com/en/articles/11175166
- [C4] platform.claude.com/docs/en/api/ip-addresses

OpenAI:
- [O1] developers.openai.com/apps-sdk/build/auth
- [O2] developers.openai.com/api/docs/guides/developer-mode
- [O3] developers.openai.com/api/docs/guides/ip-addresses
- [O4] help.openai.com/en/articles/12584461

Tailscale:
- tailscale.com/kb/1223/funnel
- tailscale.com/kb/1312/serve

Keycloak:
- keycloak.org/server/reverseproxy (exposed paths)

## Addendum: owner's change of direction (after 4b921c14)

- **Dropped from kb:** the signed-token identity provider, the reach and caps, serving resources through `render.view`, read-only mounts, and the `--token`/`--reach`/`--authorization-server` flags. kb's only change is `kb mcp --listen`, which serves the same tools and resources as stdio.
- **Access moved to the edge** (dotfiles): Funnel → oauth2-proxy → kb's 0600 socket, with Dex as the broker for pre-registered clients with secrets. §0 explains in plain words why an account allow-list alone loses to shared-callback phishing and how the secret closes it.
- **Broker re-checked in source:**
  - Pomerium 0.34.1 can turn DCR off, but has no clients with secrets;
  - mcp-auth-proxy has open DCR only;
  - Dex has static clients with secrets but exact redirects only;
  - Keycloak works, but is the heaviest.

  Dex + oauth2-proxy was picked as the least to run, with Keycloak as the fallback.
- **The reviewer's exposed-path prerequisite** is applied to the chosen broker: one route table in oauth2-proxy, everything else 404, and Dex's gRPC API off. Under the Keycloak fallback, only `/realms/<r>/` login and discovery plus `/resources/` are exposed, never `/admin` or the master realm.
- **Isolation is infra only:** a systemd sandbox without network that shows only the personal store, with the denials tested in 1b.
- **Decisions** shrink to four; read-only, caps and the "From AI" subtree are gone. Gemini's Client ID / Client secret fields are confirmed by the owner.
