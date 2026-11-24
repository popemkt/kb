# kb's MCP on the public internet, for its owner only, with Google sign-in

Research record and design proposal, 2026-11-24, based on kb at `6676cb47`
and the dotfiles repository (popemkt/mac-backup) as checked out on
shared-server. No product code. Sources were read on 2026-11-24. Anything
not seen in a source is marked *(unverified)* and listed in §8. Revised after
review; see the Addendum.

## 0. Recommendation

1. Use **Tailscale Funnel** on shared-server as the public HTTPS path. It is free, needs no domain, and TLS ends on the box, so no third party sees kb's content.
2. Put an OAuth broker behind Funnel. It must issue tokens only to **pre-registered confidential clients**, one per AI vendor, whose secret only the owner holds and types into their own connector, and it must show a consent screen. Dynamic registration (DCR) and client metadata documents (CIMD) stay **off**. Google is the broker's upstream sign-in, admitting only the owner's account (configured in dotfiles).
3. **Keycloak** (nixpkgs module) is the leading candidate. **Pomerium 0.33.4 does not qualify:** it has no pre-registered clients, no consent screen, and no redirect check on DCR (§3). The broker passing the requirement tests in §6 (phase 1c) on the tailnet is a **prerequisite for any public exposure**.
4. kb gains one generic surface, **MCP over Streamable HTTP** (`kb mcp --listen`). It is the same server and `MCP_WIRE` as stdio, plus:
   - an OAuth resource-server identity provider: verify a signed token against a configured key, issuer, audience and subject;
   - one reach that caps tools **and** resources alike.

   kb gets no Google-, Keycloak- or Tailscale-specific code.
5. **Personal store only.** The public kb runs as a **dedicated account** with no network at all. It sees one store, mounted read-only, and nothing else of `popemkt`'s. Phase 1 proves that the work store, the other stores and their sockets are unreachable before isolation is claimed.
6. Phase 1 is read-only, and done when Gemini lists kb's tools after a Google sign-in.

## 1. The three clients

All three call from the vendor's cloud, not from the browser, so the URL must be public. A tailnet-only URL cannot work.

| | Gemini web (Developer Mode / custom apps) | claude.ai custom connector | ChatGPT (developer mode / connectors) |
|---|---|---|---|
| Transport | Streamable HTTP only, MCP 2025-03-26 to 2025-11-25. No SSE [G4] | Streamable HTTP. A URL ending in `/sse` picks legacy SSE [C1] | SSE and Streamable HTTP [O2] |
| Protected Resource Metadata (RFC 9728) | Not mentioned. Discovers via AS metadata (RFC 8414 / OIDC well-known) on the server origin [G3] | Required: a 401 with `WWW-Authenticate: Bearer resource_metadata=…`. Uses only the first `authorization_servers` entry [C2] | Supported, via the well-known path or the 401 header [O1] |
| DCR (RFC 7591) | Default. Needs a `registration_endpoint` even if the server offers CIMD [G3] | Fallback [C2] | Fallback [O1] |
| CIMD | Not used [G3] | Preferred if advertised, with `none` auth (a public client) [C2] | Preferred, public client (`none`) or `private_key_jwt` [O1] |
| **Pre-registered client** | **Yes. "Additional settings → Show more": OAuth Client ID and Client secret** [G2][G1] | **Yes, "Use your own OAuth client"** (secret optional) [C1] | "Predefined OAuth clients" listed; UI and secret support *unverified* [O1] |
| Custom headers / API key | *Unverified* | Beta, limited orgs, not `Authorization` [C1] | No [O1] |
| Calls come from | Google's backend, `User-Agent: Google`, published CIDRs, port 443 [G3][G4][G5] | Anthropic's cloud, 160.79.104.0/21 and 153.61.208.0/20, port 443 only [C3][C4] | OpenAI's cloud, a published, changing list, plus an mTLS client cert [O1][O3] |
| OAuth redirect | `https://oauth-redirect.googleusercontent.com/r/*` and `/a/*` [G3] | `https://claude.ai/api/mcp/auth_callback` [C2] | `https://chatgpt.com/connector_platform_oauth_redirect` [O1] |
| PKCE / audience | S256. Audience must match the exact host [G3][G4] | S256. 10 s timeout on discovery, register and token [C2] | S256. Sends `resource` [O1] |
| Who may use it | Custom apps: 18+, **in the US**, personal account, English [G1]. Developer Mode eligibility not stated | All plans. Free gets one custom connector [C1][C3] | Pro: read/fetch only. Write MCP: Business, Enterprise/Edu [O4] |

**Why pre-registered confidential clients, not a redirect allow-list.**
Each vendor uses one callback for all of its users. An attacker can add the
owner's URL as a connector in their own Gemini or Claude account, start a
sign-in and send the owner the authorize link. A redirect allow-list passes
this, because the redirect is the vendor's real callback, and so does a CIMD
domain allow-list, because the client id is the vendor's real document. If
the owner signs in, the code lands in the attacker's connection. What stops
the attack is a client secret: the attacker's connector does not have it, so
it cannot redeem the code. Gemini and Claude both take a client id and
secret. The broker's consent screen, naming the client, is the second layer.

**Google cannot be the authorization server.** Its discovery document has no
`registration_endpoint` and no CIMD (fetched 2026-11-24). Gemini's redirect
is a wildcard (`/r/*`), which Google clients cannot register. The MCP spec
forbids accepting or passing on tokens issued for another audience [S1]. So
the broker issues its own tokens and uses Google only for sign-in. The
current spec revision (2026-07-28) deprecates DCR in favour of CIMD [S2].
Neither is used here.

## 2. kb today

- **MCP is stdio only.** `kb mcp` connects a `StdioServerTransport` (`packages/app/mcp/src/mcp.ts:391-405`). `createMcpServer` binds no transport (`mcp.ts:253-272`). The pinned SDK, 1.30.0, ships `server/webStandardStreamableHttp.js` (Request/Response, fits `Bun.serve`; checked in the Bun cache). No HTTP MCP route exists in `packages/`. It was named and deferred in `docs/brainstorms/2026-10-22-kb-tab-sessions/README.md:532`.
- **Tools are the registry; resources are not.**
  - `tools/list` calls `kb.manifest` on `MCP_WIRE` = `{carriesApproval: false, actor: "agent", caller: "program"}` (`mcp.ts:86-92`) and lists through `listedOn`. Each call goes through `onWire` and the invoke core (`mcp.ts:166-191`).
  - **`resources/list` and `resources/read` do not** (`mcp.ts:209-235`). They render views directly (`listViewRefsEffect`, `renderViewNodeEffect`), so no wire, listing rule, guard or cap applies to them. Any cap that filters only tools leaves every view readable as a resource.
  - There is **no read-only mode or allow-list**, and a call that asks for approval is refused over MCP (gap `01M3R2KD6V1AZ9WS62ZVG9T4G2`).
- **One contract, every surface.** Each surface declares one `SurfaceWire`, and `surfaceContract` (`packages/app/test-kit/src/surface-contract.ts`, rows in `packages/app/cli/tests/surfaces.ts`) proves they agree.
- **The HTTP host** (`kb ui`) binds 127.0.0.1:4321 or an owner-only socket. Its request guard (`packages/app/server/src/guard.ts:153-187`) treats a request with an allowed `Origin` as the page's. Anything else is a local program's: `HTTP_WIRE`, actor `agent`, full write power. "Governance is not a security boundary; accounts are" ([Action registry](../../DESIGN.md#action-registry)). Funnel traffic carries no identity header ([Hosted behind a proxy](../../DESIGN.md#hosted-behind-a-proxy)), so pointing Funnel at `kb ui` would give the internet write access.
- **Identity is a plugin point.** `IdentityPoint` providers answer a request with a person, a refusal or a pass, and the first answer holds (`identifyBy`, `packages/app/server/src/auth.ts:27`). The deployment chooses the providers, never the graph. The only shipped one trusts a proxy header, on a socket only (`auth.ts:65`).
- **Scoped access exists in two shapes:**
  - capture devices: a digest-stored `kbcap_` bearer, issued and revoked from the host CLI, admitted only to actions whose `callers` include `capture-device` ([Raw capture](../../DESIGN.md#raw-capture));
  - script grants: `CodeGrant {reads, actions}`, decided in the invoke core and at commit ([Grants and the script actor](../../DESIGN.md#grants-and-the-script-actor)).

  `docs/research/2026-11-20-phone-beyond-capture.md` §3 proposes a third, device scopes.
- **Actors.** A remote caller today would be `HTTP_WIRE`'s anonymous `agent`. Gap `01M413SP3QSSQJMKKDK3W3J6G8` ("a call's actor and approval are declared by the caller, not proven") closes with authenticated callers per surface. This design closes it for remote MCP.
- **One root per process** (`startUi`, `createMcpServer(root)`).

**On shared-server** (dotfiles):

- `my.stacks.kb.stores` makes each store a unit running as **its owner** (`kb ui --socket /run/kb-<owner>/kb.sock`), published by `tailscale serve --service=svc:kb-<owner>` (`modules/stacks/kb/nixos.nix:26-62`, `modules/nixos/system/services.nix:267`, `modules/stacks/vpn/services-reconcile.nix:26-40`). The personal store's root sits in `popemkt`'s home (`kb/nixos.nix:113`).
- **kb-work runs on the work Mac** (`hosts/popemkt-work/default.nix:30-54`). But any process on shared-server can reach it today: `tag:shared-server` is granted `svc:kb-work` (`configs/tailscale/policy.hujson:78-82`), and a wildcard grant remains (`:133-137`). Tailnet reach is per machine, not per account.
- Both people's accounts are in `wheel` with passwordless sudo (`hosts/shared-server/default.nix:199,217-222`).
- There is no Funnel (no `nodeAttrs`; the node's CapMap has no `funnel`; tailscaled 1.102.4), and no Keycloak, Pomerium or Cloudflare.
- There is no sops-nix or agenix. Secrets are machine-state files, read through a path in the environment (`hosts/shared-server/default.nix:313-332`).

## 3. Options compared

**Broker requirements.** These are the phase-1c acceptance tests, and every one must pass on the tailnet before Funnel is switched on:

- R1: pre-registered confidential clients only, each with exact redirect URIs (Gemini's needs a trailing wildcard); no DCR and no CIMD.
- R2: a consent screen that names the client.
- R3: Google as upstream sign-in, admitting only the owner's subject.
- R4: tokens bound to the MCP resource as their audience.
- R5: an access-token lifetime of minutes, rotating refresh tokens, and revocation of refresh tokens and sessions.
- R6: declarable in NixOS, with secrets from files.

| Broker | R1 | R2 | R3 | R4 | R5 | R6 | Verdict |
|---|---|---|---|---|---|---|---|
| **Pomerium 0.33.4** | **No.** Clients come only from DCR or CIMD (`internal/mcp/handler_authorization.go:371`). DCR stores what it is sent, with no redirect check (`handler_register_client.go`). CIMD admits public clients (`none`) only (`:24-26`) | **No.** After sign-in it redirects straight to the client with a code (`AuthorizationResponse`) | Yes | Yes. The assertion's `aud` is the route hostname (`authorize/evaluator/headers_evaluator_evaluation.go:350`) | Refresh TTL hard-coded to **365 days** (`internal/mcp/handler_token.go:28`) | Module | **Disqualified** |
| **Keycloak** | Confidential clients, exact redirects with a trailing `*` allowed, client registration can be turned off | "Consent required" per client | Google identity brokering; registration off; link only the owner | An audience mapper sets `aud` to the MCP URL | Access-token lifespan setting (default 5 min), refresh-token revocation, session logout | `services.keycloak` (+ PostgreSQL) | **Leading candidate.** All columns are from Keycloak's documented features, untested for this flow *(unverified)* |
| Cloudflare Access Managed OAuth | DCR with a redirect allow-list only, which fails the shared-callback attack (§1). Static clients *unverified* | *Unverified* | Yes | Yes | *Unverified* | Cloudflare account, not nix. **Needs a domain (~$10/yr, a paid item)** | Fallback only if R1/R2 verify. Cloudflare sees content |
| Dex | Static clients declared in YAML, exact redirects only *(unverified: Gemini's wildcard likely fails)* | Approval screen | Google connector | `aud` is the client id, not the resource | Partial | `services.dex` | Likely fails Gemini and R4 |
| ZITADEL / authentik | Confidential clients | Yes | Yes | *Unverified* | Yes | ZITADEL module lags; authentik has no module | Heavier, no gain |
| oauth2-proxy / Authelia / Kanidm | No upstream-IdP broker or no MCP fit [OP1] | | | | | | No |

**Exposure.**

| Option | Public surface | Cost | Verdict |
|---|---|---|---|
| **Tailscale Funnel** | The node's `*.ts.net` name, port 443. tailscaled terminates TLS, and the relay is TCP passthrough that "cannot decrypt" [T1]. Path mounts allowed (`--set-path`) | $0. Bandwidth capped, figure unpublished. Beta | **Use** |
| Cloudflare Tunnel | A Cloudflare-zone hostname. Cloudflare terminates TLS | Domain, a paid item | Only with Access (above) |
| VPS reverse proxy | Another internet-facing machine | Hetzner CX23 €5.99/mo, paid; Oracle Always Free $0 [V1][V2] | No gain |
| Cloud Run + IAP | `*.run.app`. IAP targets developer CLIs, not these clients [GC1] | Billed | Does not fit |

## 4. Architecture

```
 Gemini / claude.ai / ChatGPT backends            owner's browser (sign-in, consent)
                │  HTTPS :443  https://<node>.<tailnet>.ts.net                 │
                ▼                                                             ▼
        Tailscale Funnel relay (TCP passthrough)
                │
 ┌─ shared-server ───────────────────────────────────────────────────────────────┐
 │ tailscaled (root): TLS for *.ts.net; Funnel path mounts                        │
 │   /mcp, /.well-known/oauth-protected-resource ──► unix:/run/kb-mcp/mcp.sock    │
 │   /auth/                                       ──► http://127.0.0.1:<k>        │
 │                                                                               │
 │ Keycloak (realm "kb")  ── OIDC ──► accounts.google.com                         │
 │   3 confidential clients (gemini, claude, chatgpt), exact redirects,          │
 │   consent required, client registration off, only the owner's linked user,    │
 │   access token 5 min, refresh rotation, aud = https://<host>/mcp              │
 │                                                                               │
 │ kb-remote-mcp: User=kb-mcp-popemkt (no login, no wheel)                        │
 │   kb --root /srv/store mcp --listen unix:/run/kb-mcp/mcp.sock                  │
 │      --token issuer=https://<host>/auth/realms/kb,key=<realm pubkey file>,     │
 │              audience=https://<host>/mcp,subject=<owner sub>                   │
 │      --authorization-server https://<host>/auth/realms/kb  --reach reach.json  │
 │   PrivateNetwork=yes, RestrictAddressFamilies=AF_UNIX                          │
 │   ProtectHome=yes, BindReadOnlyPaths=<personal root>:/srv/store                │
 │   socket mode 0600 owned by kb-mcp-popemkt (only root/tailscaled connects)    │
 └───────────────────────────────────────────────────────────────────────────────┘
   kb-work (work Mac), app-kb and app-kb-bytetum sockets, popemkt's home: unreachable
```

**What kb gains** (all generic; Rule 1 applied):

1. **A transport.** `kb mcp --listen <unix:path | host:port>` connects `createMcpServer`'s server to the SDK's web-standard Streamable HTTP transport under `Bun.serve`.
   - It serves only `/mcp` and `/.well-known/oauth-protected-resource` (RFC 9728, naming `--authorization-server`). A request without a valid token gets `401` with `WWW-Authenticate: Bearer resource_metadata=…`.
   - No page, `/api`, `/ws`, channel or capture.
   - Its answers equal stdio's and one-shot answers ([Hosts are accelerators](../../AGENTS.md#hosts-are-accelerators)). The surface contract gains one row.
2. **One signed-token identity provider** on `IdentityPoint`, configured by the deployment:
   - Configuration: where the token is (`Authorization: Bearer` by default, or a named header), the issuer, a public key or JWKS **file**, the audience and the admitted subjects.
   - A valid token for an admitted subject names the person. A bad signature, wrong issuer or audience, expiry or unknown subject is a refusal; a missing token is a pass, and the listener refuses it.
   - The same provider serves a proxy assertion if the deployment ever uses one. Behind Pomerium that would be `X-Pomerium-Jwt-Assertion`, with `audience=<route hostname>` (a hostname, not a URL), over a channel only the proxy can reach.
   - It closes gap `01M413SP3QSSQJMKKDK3W3J6G8` for this surface. `--identity-header` stays the socket-only proxy-header provider.
3. **One reach over every path.** It is generalised from the script grant: a call carries a reach stamped by its surface, and the invoke core decides it once, at call time and at commit, as it decides grants today.
   - **Resources become action projections:** `resources/list` is `render.views` and `resources/read` is `render.view`, both invoked on the wire. So the reach that hides a tool also refuses the resource, and stdio gains the same honesty.
   - Calls by tool name, by alias and nested (`callWithin`) all pass the same decision.
   - The reach comes from the deployment (`--reach`, `CodeGrant`-shaped), never from the graph, so a caller with writes cannot widen it.
   - **No `outsideRoot` action is ever in a reach.**
   - Phase 1 reach: `reads: graph` plus named reads such as `render.view`/`render.views`, and no writes.
4. **Attribution.** A write records actor `agent` and `via: "mcp-remote:<person>"`, stamped by the wire. Reads are audited by tailscaled's and Keycloak's logs (journald).

The phone's proposed device scopes should become a reach too: one shape for
"what may this caller do". If generalising the grant is too large for phase
1, stop and record a gap rather than adding a second allow-list.

**Request flow, from sign-in to a tool call (Gemini):**

1. The owner creates the `gemini` client in Keycloak (declared in dotfiles, secret in machine state). In Gemini → Developer Mode → Connect to an MCP server they enter `https://<host>/mcp` and, under Additional settings → Show more, that client id and secret.
2. Gemini's backend discovers the authorization server: AS metadata, or PRM from kb's 401 (Claude does the latter). How Gemini finds a path-based issuer is a phase-1c test (§8).
3. The browser goes to Keycloak's `/authorize` (PKCE S256). Keycloak sends it to Google. Back from Google, Keycloak admits only the linked owner account and **shows consent naming "Gemini"**. Then it redirects with a code to `oauth-redirect.googleusercontent.com/r/…`.
4. Gemini's backend redeems the code at `/token` **with the client secret** and gets an access token (5 min, `aud=https://<host>/mcp`) and a rotating refresh token. A connection started by anyone else fails here: it lacks the secret.
5. `POST /mcp` `tools/list` with the bearer token. tailscaled forwards it over the root-only socket. kb verifies the signature (pinned key file), issuer, audience, expiry and subject, and names the person. It lists `kb.manifest` on the MCP wire under the reach: read tools only.
6. `tools/call graph_search` passes the reach check, reloads from the read-only mount, and returns the receipt. `resources/read ui://kb/view/<id>` takes the same path through `render.view`.

## 5. Security model and threats

**Boundary.** A call reaches kb only with a 5-minute token issued to one of
three pre-registered clients, after the owner's Google sign-in and consent.
kb checks the token itself. The reach caps tools and resources together. The
kb process has no network, no account privileges, and nothing on disk but one
store, read-only. Anything a vendor reads is disclosed to that vendor; that is
why only the personal store is exposed.

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| 1 | Anyone on the internet calls `/mcp` | 401 without a valid token. Funnel mounts only `/mcp`, PRM and `/auth/`. Optional: allow only the vendors' CIDRs | tailscaled TLS and Keycloak are internet-facing; keep both current |
| 2 | Another Google account signs in | Registration off; only the pre-linked owner account; kb also pins `sub` | — |
| 3 | **Consent phishing through an attacker's own vendor account** | Confidential clients: the attacker cannot redeem the code without the secret. Consent names the client. DCR and CIMD off. Phase 1c tests this exact attack | A breach of the owner's vendor account exposes the secret; rotate it |
| 4 | Replay of a captured token | `aud`-bound, 5-minute lifetime, TLS end to end. The kb socket admits only root (tailscaled). There is no proxy-assertion hop to capture | A vendor or root holding a live token, for ≤ 5 min |
| 5 | A vendor's stored refresh token leaks | Rotation. Revoke one client's sessions, or all, in Keycloak. Rotating the realm key kills every access token at once (kb pins the key file) | Reads until revoked |
| 6 | Prompt injection drives tool calls | Phase 1 reads only (reach **and** a read-only mount). Later writes stay in one subtree; approval-required actions are refused over MCP | Read results reach the same vendor's model |
| 7 | **The work store or other stores leak** | kb-work is on another machine, and the kb unit has **no network** (`PrivateNetwork`, `AF_UNIX` only), so it cannot dial `svc:kb-work`. It runs as a dedicated account that cannot read `popemkt`'s home, the other stores, or `/run/kb-*` sockets. It sees one store via a read-only bind mount. No `outsideRoot` action is ever reachable. **Phase 1d tests each denial from inside the unit** | Root on the box (both people are passwordless `wheel`) |
| 8 | A local account calls kb directly | Socket mode 0600 owned by `kb-mcp-popemkt`: only root connects. Tokens are verified anyway | Root |
| 9 | A resource or alias bypasses the cap | Resources are `render.view(s)` calls through the invoke core. Tests call denied resources, aliases and `outsideRoot` tools directly | — |
| 10 | Load (expensive `graph.query`) | Funnel's bandwidth cap; the unit's `CPUQuota`/`MemoryMax` | Slowness on a shared store |
| 11 | Host discovered (CT logs) | Expected; probes get 401 or 404 | Node and tailnet names are public |
| 12 | Host secrets or extensions via kb | Private, empty `KB_DATA`: no secrets, trust ledger or installed extensions | — |

**Revocation, verified at the broker in phase 1c:**

- one client: revoke its sessions or rotate its secret;
- everything: rotate the realm signing key and update kb's key file;
- stop: §6, "Off switch".

## 6. Build plan

One PR per row, kb first; dotfiles pins the new kb. Phase 1 is done when
1a–1d have landed.

**Phase 0 (owner, no code).**

- Confirm Gemini Developer Mode's "Connect to an MCP server" is offered. Custom apps are documented as US-only [G1]; if Gemini is not offered, start with claude.ai.
- Create the Google OAuth client for Keycloak's Google sign-in (free). Its redirect is Keycloak's broker endpoint on the Funnel host.

**1a — kb, restructure (behaviour-preserving): `refactor: one reach for tools and resources`.**

- Change: generalise `ActionInvocation.script` to a surface-stamped reach. Serve MCP resources through `render.views`/`render.view` on the wire. Update DESIGN.md → Grants and Surfaces.
- Accepts: `script-run.test.ts`, `sandboxContract`, the surface contract and the MCP view-app tests pass unchanged. Typecheck and lint pass.

**1b — kb: `feat: MCP over Streamable HTTP as an OAuth resource server`.**

- Change: `kb mcp --listen`, `--token`, `--authorization-server`, `--reach` (§4). Update DESIGN.md (Surfaces, Who the person is) and record the wire fingerprint.
- Accepts:
  - the surface contract's HTTP MCP row lists what stdio lists under a full reach;
  - no token → 401 with `resource_metadata`; bad signature, wrong issuer or audience, expired token or unknown subject → 401;
  - under the read reach:
    - `node_add` is unlisted, and calling it is refused `forbidden`;
    - a call by an alias name is refused;
    - no `outsideRoot` tool is listed, and calling `extension_outdated` (an `outsideRoot` read) directly is refused;
    - with `render.view` removed from the reach, `resources/list` is empty and `resources/read` is refused;
  - kb serves reads from a **read-only root** (store opened on a read-only directory);
  - `GET /` and `/api/action` → 404.

**1c — dotfiles: `feat: an OAuth broker for kb's MCP, tailnet only`.**

- Change: `modules/stacks/mcp-gateway` wraps `services.keycloak`: a realm, three clients, the Google identity provider and an imported realm key, with secrets through `LoadCredential=`. It is published on the tailnet only (`tailscale serve`), **not Funnel**.
- Accepts R1–R6:
  - the registration endpoint is absent or 403, and an unknown `client_id` is refused;
  - **the phishing test:** a flow started with the `gemini` client id but redeemed with the wrong secret fails;
  - the consent screen names the client;
  - a second Google account is denied;
  - the access token's `aud` is the MCP URL and it expires in 5 minutes;
  - a revoked refresh token and a logged-out session both stop refresh;
  - after a realm-key rotation, kb refuses old tokens.

**1d — dotfiles: `feat(kb): public MCP for the personal store`.**

- Change, gated on 1c passing:
  - `my.stacks.kb.stores.<store>.remoteMcp = { enable; subject; reach; }` creates the `kb-mcp-popemkt` system user and the sandboxed `kb-remote-mcp` unit (§4), plus a read ACL for that user on the personal root only;
  - the vpn stack gains a declared Funnel oneshot (path mounts to the kb socket and to Keycloak; no NixOS module covers Funnel) and an off switch;
  - `policy.hujson` gets `nodeAttrs: [{target: ["tag:shared-server"], attr: ["funnel"]}]`, and `check-tailscale-policy.sh` requires Funnel to be declared.
- Accepts:
  - **denials, run inside the unit** (`nsenter` into its namespaces as its user):
    - connecting to `svc:kb-work` fails, as does any TCP connect;
    - reading `~popemkt`, `~bytetum` or the work store's path fails;
    - connecting to `/run/kb-popemkt/kb.sock` or `/run/kb-bytetum/kb.sock` fails;
    - writing `/srv/store` fails with `EROFS`;
  - from outside the tailnet:
    - `curl -i https://<host>/mcp` → 401 with discovery;
    - `/` → 404;
  - **Gemini lists kb's tools after a Google sign-in and consent**, and `graph_search` answers.

**Phase 2 — dotfiles: claude.ai and ChatGPT.**

- Change: the `claude` client is a confidential client typed into "Use your own OAuth client". ChatGPT joins only if its predefined-client UI takes a secret; otherwise it waits.
- Accepts: each lists the tools.

**Phase 3 (only if wanted) — kb then dotfiles: `feat: remote writes bounded to one subtree`.**

- Change: the reach names a subject (a "From AI" node) and `node.add`/`node.update`. The mount becomes read-write with a write ACL. Commit refuses anything outside the subject.
- Accepts: the grant tests run over the remote wire, and `graph.changes` shows `via: mcp-remote:<person>`.

**Off switch.**

- Declared: `remoteMcp.enable = false`, or removing the Funnel declaration (the reconcile runs `tailscale funnel reset`), then rebuild.
- Immediate: `sudo tailscale funnel reset`, or `systemctl stop kb-remote-mcp`.
- `app-kb` is never touched.

## 7. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| 1 | Broker: Keycloak (~1 GB RAM + PostgreSQL, $0), Cloudflare Access (paid domain, unverified R1/R2), or wait for Pomerium to gain pre-registered clients and consent | **Keycloak**, if it passes 1c. If it fails, stop and re-decide; do not expose with a broker that fails R1–R2 |
| 2 | Phase-1 scope: read-only across the whole personal store | **Yes.** Reads only, enforced by the reach and the read-only mount |
| 3 | Writes later? | **Only add and update in one "From AI" subtree**, or never |
| 4 | Where the ceiling (reach, subject, clients) lives | **Dotfiles**, never the graph |
| 5 | Secrets: the machine-state file pattern, or adopt sops-nix now | **Existing pattern** via `LoadCredential=`; sops-nix separately |
| 6 | Tailnet hygiene: drop the wildcard grant, and narrow `tag:shared-server` → `svc:kb-work` | **Yes, as a separate dotfiles PR.** Isolation holds without it (no network in the unit), but the declared grants become real |

## 8. Unverified

- Gemini:
  - Developer Mode plans and regions (custom apps are US-only [G1]);
  - how Gemini discovers a **path-based issuer** (`/auth/realms/kb`) when it does not follow PRM. If it needs AS metadata at the origin root, Keycloak needs its own hostname, which on Funnel means a second node;
  - reports of Gemini stalling after the OAuth callback (forum threads discuss.ai.google.dev/t/186405, /t/177327).
- Keycloak:
  - every R1–R6 claim for this flow;
  - trailing-wildcard redirects accepting Gemini's `/r/*`;
  - linking only a pre-existing user on first Google login;
  - running behind Funnel's path mount with `X-Forwarded-*`.
- ChatGPT: whether "predefined OAuth clients" take a secret; Plus access.
- Whether kb opens a store on a read-only mount without writing (lock files, caches). Test 1b settles it.
- Whether all three clients accept a stateless Streamable HTTP server.
- Funnel: path mounts to a `unix:` target; the bandwidth figure.
- Cloudflare Access: static clients and consent.
- Google's terms for content Gemini reads through a connector. The owner should read them before 1d.

**Verified in source on 2026-11-24 (pomerium/pomerium at v0.33.4):**

- `internal/mcp/handler_register_client.go`: DCR parses and validates metadata, then stores it, with no redirect allow-list.
- `internal/mcp/handler_authorization.go`: clients are CIMD or DCR-stored (`:371`); CIMD admits only `none` (`:24-26`); no consent step before the code redirect.
- `internal/mcp/handler_token.go:28`: `RefreshTokenTTL = 365 * 24 * time.Hour`.
- `authorize/evaluator/headers_evaluator_evaluation.go`: header `x-pomerium-jwt-assertion` (`:83`), `aud` = request hostname (`:350`).

**Sources.**

Gemini:
- [G1] support.google.com/gemini/answer/17209137
- [G2] developers.google.com/connected-apps/mcp/dev-mode/usage (2026-10-28)
- [G3] developers.google.com/connected-apps/mcp/oauth (2026-09-14)
- [G4] developers.google.com/connected-apps/mcp/server-optimization
- [G5] developers.google.com/connected-apps/mcp/mcp-flow (2026-10-27)

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

MCP spec:
- [S1] modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- [S2] modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration

Tailscale:
- [T1] tailscale.com/kb/1223/funnel, tailscale.com/kb/1311/tailscale-funnel, tailscale.com/kb/1312/serve

Cloudflare:
- [CF1] developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/
- [CF2] cloudflare.com/plans/sase-zero-trust

VPS:
- [V1] hetzner.com/cloud/cost-optimized
- [V2] docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm

Google Cloud:
- [GC1] docs.cloud.google.com/run/docs/ai/authenticate-mcp-servers

Brokers:
- [OP1] github.com/oauth2-proxy/oauth2-proxy/issues/3167
- [K1] keycloak.org/securing-apps/mcp-authz-server
- Pomerium: pomerium.com/docs/capabilities/mcp/reference

## Addendum: review of 28e78ef0 (four security findings)

1. **DCR redirect allow-list (§0, §1, §3, §6 1c, §8).** Confirmed in Pomerium 0.33.4: DCR has no redirect check, there is no consent step, and CIMD admits public clients only. A redirect allow-list would not have been enough anyway, because vendor callbacks are shared by every user (§1). The design now requires pre-registered confidential clients plus consent, with DCR and CIMD off. Pomerium is disqualified. The broker passing R1–R6, including the phishing test, on the tailnet is a phase-1 prerequisite to Funnel.
2. **Assertion header, audience and channel (§4 item 2, §5 #4).** kb now verifies the broker's audience-bound access token directly, so there is no proxy-assertion hop to replay. kb's socket admits only root (tailscaled). The provider still serves a proxy assertion if one is ever used: `X-Pomerium-Jwt-Assertion`, audience = route hostname, over a proxy-only channel. Resource binding and revocation are verified at the broker in 1c.
3. **Account isolation (§4 diagram, §5 #7, §6 1d).** The public kb runs as the dedicated `kb-mcp-popemkt` account with no network namespace, `AF_UNIX` only, `ProtectHome`, and one store mounted read-only. Phase 1d tests each denial from inside the unit before isolation is claimed: work store, other stores, sockets, popemkt's home, TCP.
4. **Resources bypass the dispatcher (§2, §4 item 3, §6 1a/1b).** Confirmed at `mcp.ts:209-235`. Resources become `render.views`/`render.view` calls on the wire, so one reach covers both paths. 1b tests denied resources, aliases and `outsideRoot` tools by direct call.
