# kb's MCP on the public internet, for its owner only, with Google sign-in

Research record and design proposal, 2026-11-24, based on kb at `6676cb47`
and the dotfiles repository (popemkt/mac-backup) as checked out on
shared-server. No product code. Sources were read on 2026-11-24. Anything
not seen in a source is marked *(unverified)* and listed in §8.

## 0. Recommendation

1. Use **Tailscale Funnel** on shared-server as the public HTTPS path. It is free, needs no domain, and TLS ends on the box, so no third party sees kb's content.
2. Put **Pomerium** behind Funnel as the OAuth authorization server for MCP clients. It is open source and has a NixOS module. Google is its upstream sign-in, and its policy admits only the owner's account, which is configured in dotfiles. A broker is unavoidable: Google offers neither the client registration Gemini needs nor the CIMD that Claude and ChatGPT prefer.
3. Give kb one generic surface, **MCP over Streamable HTTP** (`kb mcp --listen`). It is the same `createMcpServer` and `MCP_WIRE` as stdio, plus two generic pieces:
   - a signed-assertion identity provider, which refuses any request a trusted proxy has not vouched for;
   - a reach (the script grant, generalised), which caps what a remote caller may call.

   kb gets no Google-, Pomerium- or Tailscale-specific code.
4. Expose only the personal store. kb-work already lives on another machine. The public unit opens one root, has no network egress beyond loopback, keeps a private, empty Locations list, and its reach excludes every `outsideRoot` action. Leaking kb-work would take several independent failures, not one mistake.
5. Phase 1 is read-only and done when Gemini lists kb's tools after a Google sign-in. Writes come later, if at all, and only into one subtree.

## 1. The three clients

All three call from the vendor's cloud, not from the browser, so the URL must be public. A tailnet-only URL cannot work.

| | Gemini web (Developer Mode / custom apps) | claude.ai custom connector | ChatGPT (developer mode / connectors) |
|---|---|---|---|
| Transport | Streamable HTTP only, MCP 2025-03-26 to 2025-11-25. No SSE [G4] | Streamable HTTP. A URL ending in `/sse` picks legacy SSE [C1] | SSE and Streamable HTTP [O2] |
| Protected Resource Metadata (RFC 9728) | Not mentioned. Discovers via AS metadata (RFC 8414 / OIDC well-known) on the server origin [G3] | Required: a 401 with `WWW-Authenticate: Bearer resource_metadata=…`. Uses only the first `authorization_servers` entry [C2] | Supported, via the well-known path or the 401 header [O1] |
| Dynamic Client Registration (RFC 7591) | **Required.** Needs a `registration_endpoint` even if the server offers CIMD [G3] | Fallback. Registers anew on each fresh connection [C2] | Fallback [O1] |
| Client ID Metadata Documents | Not used [G3] | Preferred, if AS metadata has `client_id_metadata_document_supported: true` and `none` among auth methods [C2] | Preferred. client_id `https://chatgpt.com/oauth/…/client.json` [O1] |
| Static client id/secret | Yes. "Additional settings → Show more" holds **OAuth Client ID and Client secret** [G2][G1] | Yes, "Use your own OAuth client" [C1] | "Predefined OAuth clients" listed, UI not described [O1] |
| Custom headers / API key | *Unverified*, not on any Google page | Beta, limited orgs, cannot set `Authorization` [C1] | No: "cannot present custom API keys" [O1] |
| Calls come from | Google's backend, `User-Agent: Google`, published CIDRs, port 443 [G3][G4][G5] | Anthropic's cloud, 160.79.104.0/21 and 153.61.208.0/20, port 443 only [C3][C4] | OpenAI's cloud, a published, changing list, plus an OpenAI mTLS client cert [O1][O3] |
| OAuth redirect | `https://oauth-redirect.googleusercontent.com/r/*` and `/a/*` [G3] | `https://claude.ai/api/mcp/auth_callback` [C2] | `https://chatgpt.com/connector_platform_oauth_redirect` (with RFC 9207 `iss`) [O1] |
| PKCE / audience | PKCE S256. Token audience must match the exact host [G3][G4] | S256. 10 s timeout on discovery, register and token [C2] | S256 required. Sends `resource` [O1] |
| Who may use it | Custom apps: 18+, **in the US**, personal Google account, English, activity on [G1]. Developer Mode eligibility not stated | All plans. Free gets one custom connector [C1][C3] | Pro: read/fetch only. Full (write) MCP: Business, Enterprise/Edu. Web only [O4] |

**Google cannot be the authorization server.** Its discovery document
(`accounts.google.com/.well-known/openid-configuration`, fetched 2026-11-24)
has no `registration_endpoint` and no CIMD support. Gemini's redirects are
wildcards (`/r/*`), and Google OAuth clients take exact redirect URIs, so a
Google client typed into Gemini's static fields would most likely fail
*(inferred)*. A broker must offer DCR (Gemini) and CIMD (Claude, ChatGPT),
use Google only for sign-in, and issue its own audience-bound tokens. The
MCP spec forbids a server from accepting or passing through tokens issued
for another audience [S1].

**Spec version.** The current revision is 2026-07-28. It deprecates DCR in
favour of CIMD [S2]. Gemini still requires DCR, so the broker keeps DCR
switched on.

## 2. kb today

- **MCP is stdio only.** `kb mcp` connects a `StdioServerTransport` (`packages/app/mcp/src/mcp.ts:391-405`). `createMcpServer` binds no transport ("callers connect stdio or InMemoryTransport", `mcp.ts:253-272`), and that is where a second transport plugs in. The pinned SDK, `@modelcontextprotocol/sdk` 1.30.0, ships `server/webStandardStreamableHttp.js` (checked in the Bun cache). That transport is Request/Response based and fits `Bun.serve`. No `/mcp`, SSE or Streamable HTTP route exists anywhere in `packages/`. A remote transport was named and deferred in `docs/brainstorms/2026-10-22-kb-tab-sessions/README.md:532`.
- **Tools are the registry.** `tools/list` calls `kb.manifest` on `MCP_WIRE` = `{carriesApproval: false, actor: "agent", caller: "program"}` (`mcp.ts:86-92`). It lists through `listedOn`, and each tool's hints come from the action's mode (`readOnlyHint` for a read, `destructiveHint` for a write, `openWorldHint` for `outsideRoot`; [Action registry](../../DESIGN.md#action-registry)). A call that asks for approval is refused over MCP (gap `01M3R2KD6V1AZ9WS62ZVG9T4G2`). **There is no read-only mode or tool allow-list:** an MCP client may call every write an agent may.
- **One contract, every surface.** Each surface declares one `SurfaceWire`, and `surfaceContract` (`packages/app/test-kit/src/surface-contract.ts`, rows in `packages/app/cli/tests/surfaces.ts`) proves that every surface lists and answers alike. A new surface joins that map.
- **The HTTP host** (`kb ui`) binds 127.0.0.1:4321 or an owner-only Unix socket (`--socket`, mode 0600). Its request guard (`packages/app/server/src/guard.ts:153-187`) checks `Host` and `Origin`:
  - a request with an allowed `Origin` is the page's;
  - any other request is a local program's (`HTTP_WIRE`, actor `agent`, full write power).

  [Who the person is](../../DESIGN.md#action-registry) states the trade-off plainly: "governance is not a security boundary; accounts are". Over Funnel, a request carries no identity header ([Hosted behind a proxy](../../DESIGN.md#hosted-behind-a-proxy)), so pointing Funnel at today's `kb ui` would hand the internet write access.
- **Identity is a plugin point.** `IdentityPoint` providers answer a request with a person, a refusal or a pass. The first answer holds (`identifyBy`, `packages/app/server/src/auth.ts:27`). The deployment's composition root chooses the providers; they are never a graph write. The one shipped provider trusts a proxy header, and only on a socket (`identityHeaderIdentity`, `auth.ts:65`).
- **Scoped credentials exist in two shapes:**
  - Capture devices: a one-use pairing code from the host CLI, then a `kbcap_` bearer. The store keeps only a digest, and `capture.revoke` deletes it. Such a caller reaches only actions whose `callers` admit `capture-device` ([Raw capture](../../DESIGN.md#raw-capture)).
  - Script grants: `CodeGrant {reads: none | subject | graph, actions}`, decided once in the invoke core (`scriptRefusal`) and again at commit ([Grants and the script actor](../../DESIGN.md#grants-and-the-script-actor)).

  `docs/research/2026-11-20-phone-beyond-capture.md` §3 proposes a third shape, device scopes. That is three shapes for one concept.
- **Actors.** A remote caller today would be `HTTP_WIRE`: actor `agent`, caller `program`, no approval, unnamed. A transaction records `actor`, `session` and `via` (`KB_VIA`), but no authenticated principal. Gap `01M413SP3QSSQJMKKDK3W3J6G8` ("a call's actor and approval are declared by the caller, not proven") closes with "authenticated callers per surface … checked where the actor is filled in". This design closes it for remote MCP.
- **One root per process.** `startUi` and `createMcpServer(root)` each bind one root for life, so pinning a host to exactly one store is already how kb works.

**On shared-server** (dotfiles):

- `my.stacks.kb.stores` turns each store into a `my.services` unit: `kb ui --socket /run/kb-<owner>/kb.sock`, published as a Tailscale Service by `tailscale serve --service=svc:kb-<owner>` (`modules/stacks/kb/nixos.nix:26-62`, `modules/stacks/vpn/services-reconcile.nix:26-40`).
- **kb-work is not on shared-server.** It runs on the work Mac as `svc:kb-work` (`hosts/popemkt-work/default.nix:30-54`). However:
  - `tag:shared-server` may reach `svc:kb-work` (bb's agent tools, `configs/tailscale/policy.hujson:78-82`);
  - a wildcard `*`→`*` grant is still in place (`:133-137`).

  So any process on shared-server can reach kb-work over the tailnet today, and isolation has to be built into the public process, not left to the network.
- **No Funnel anywhere.** The policy has no `nodeAttrs` (the node's CapMap has no `funnel` capability; tailscaled 1.102.4). No Pomerium, Cloudflare, oauth2-proxy or nginx.
- **No sops-nix or agenix.** Secrets are machine state, placed by `scripts/shared-server-secrets`, and a service reads them from a file path in its environment (`hosts/shared-server/default.nix:313-332`).

## 3. Options compared

| Option | Public surface | OAuth for MCP clients | Code lives | Cost | Main risk |
|---|---|---|---|---|---|
| **A. Funnel + Pomerium on the box** | `https://<node>.<tailnet>.ts.net:443`. tailscaled terminates TLS; the Funnel relay is TCP passthrough and "cannot decrypt" [T1] | Pomerium's `mcp: server` route: OAuth 2.1 AS, CIMD (allow-listed domains), DCR behind a flag, refresh rotation, upstream Google [P1][P2] | dotfiles: Pomerium module config, a Funnel oneshot, a policy `nodeAttrs`. kb: the generic surface | $0 | Pomerium and tailscaled are now internet-facing. Funnel bandwidth is capped, figure unpublished [T1]. Funnel is beta |
| **B. Cloudflare Tunnel + Access Managed OAuth** | A hostname on a Cloudflare zone. Cloudflare terminates TLS and sees all content | Access is the AS: RFC 8414/9728, DCR with a redirect allow-list. CIMD not documented. Open beta [CF1] | dotfiles: cloudflared plus a Cloudflare account config (not in nix). kb: the same generic surface, verifying `Cf-Access-Jwt-Assertion` | Zero Trust Free $0 (< 50 users) [CF2], **plus a domain (~$10/yr, a paid item)** | A third party in the data path. An account and config outside the repo. Beta |
| **C. Small VPS reverse proxy into the tailnet** | The VPS's IP and domain | Still needs a broker (A's Pomerium, moved) | dotfiles: one more host | Hetzner CX23 €5.99/mo (paid); Oracle Always Free $0 [V1][V2] | One more internet-facing machine to patch, for nothing A lacks |
| **D. Cloud Run + IAP** | `*.run.app` | IAP is documented for developer CLIs; no RFC 9728/DCR, and no claude.ai or ChatGPT path [GC1] | Google Cloud | IAP free, Cloud Run billed | Does not fit the clients. Moves the store to Google |
| *Other brokers* | — | oauth2-proxy: no MCP support [OP1]. Keycloak: CIMD experimental [K1]. ZITADEL and authentik: DCR, heavy and lagging in nixpkgs. Authelia and Kanidm: no DCR yet. sigbit/mcp-auth-proxy: light (MIT), claims Claude and ChatGPT support, DCR/CIMD and nixpkgs status unverified [M1] | | | |

**A wins.** It is the only free option that keeps TLS and content on the
owner's box, and every piece of it is declarable in dotfiles. B is the
fallback if Pomerium fails the phase-1 spike, at the cost of a domain and a
third party in the data path. In both, kb's side is identical: it verifies a
signed assertion from whichever proxy the deployment names. That is the
point of keeping auth generic in kb.

## 4. Architecture

```
 Gemini / claude.ai / ChatGPT backends          owner's browser (sign-in only)
                 │  HTTPS :443  https://<node>.<tailnet>.ts.net/mcp     │
                 ▼                                                      ▼
        Tailscale Funnel relay (TCP passthrough, no TLS termination)
                 │
 ┌─ shared-server ───────────────────────────────────────────────────────────┐
 │  tailscaled (root): terminates TLS (*.ts.net cert), funnel 443 →          │
 │                     http://127.0.0.1:<p>   (no identity headers)           │
 │                 │                                                         │
 │  Pomerium (user pomerium, insecure_server on loopback)  ──OIDC──► Google  │
 │   /.well-known/oauth-authorization-server, /oauth-protected-resource       │
 │   DCR /register · CIMD (claude.ai, chatgpt.com) · /authorize · /token      │
 │   policy: the owner's Google subject (dotfiles)                            │
 │   route /mcp only; everything else 404                                     │
 │                 │  http://127.0.0.1:<q>/mcp  + X-Pomerium-Assertion (JWT)  │
 │                 ▼                                                         │
 │  kb-remote-mcp (user popemkt, sandboxed unit)                              │
 │   kb --root <personal root> mcp --listen 127.0.0.1:<q>                     │
 │      --assertion header=X-Pomerium-Assertion,key=<pubkey file>,            │
 │                  audience=https://<node>.<tailnet>.ts.net,subject=<sub>    │
 │      --reach <reach.json>                                                  │
 │   IPAddressDeny=any, IPAddressAllow=localhost · private KB_HOME/KB_DATA    │
 │                 ▼                                                         │
 │  personal store (same root app-kb serves; kb's lock and watcher)          │
 └───────────────────────────────────────────────────────────────────────────┘
   kb-work: on the work Mac, unreachable from kb-remote-mcp (no egress)
```

**What kb gains** (all generic, Rule 1 applied):

1. **A transport, not a surface fork.** `kb mcp --listen <host:port | unix:path>` connects `createMcpServer`'s server to the SDK's web-standard Streamable HTTP transport under `Bun.serve`. It serves `/mcp` and nothing else: no page, `/api`, `/ws`, channels or capture. The tools, resources and receipts are stdio's, so the surface contract gains one row and proves they match. It is a long-running host like `kb ui`, and its answers equal one-shot answers ([Hosts are accelerators](../../AGENTS.md#hosts-are-accelerators)).
2. **A signed-assertion identity provider** contributing to `IdentityPoint`, configured by the deployment: a header name, a public key or JWKS file, an issuer, an audience and the admitted subjects.
   - A valid assertion for an admitted subject names the person.
   - A bad signature, wrong audience, expired token or unknown subject is a refusal.
   - A missing assertion is a pass, so the request is nobody's.

   The same provider fits Cloudflare's `Cf-Access-Jwt-Assertion`, and it does not need a socket, because a forged header fails the signature check. This closes gap `01M413SP3QSSQJMKKDK3W3J6G8` for this surface. `--identity-header` stays as is: it is the one provider meant for a proxy reached only through an owner-only socket.
3. **A listener that requires a person.** On `kb mcp --listen`, a request nobody is identified as gets `401`. kb serves no OAuth metadata itself: discovery is the broker's, and the broker answers unauthenticated requests before kb sees them.
4. **A reach for the listener, generalised from the script grant.** Today a grant bounds only a script's calls (`ActionInvocation.script`, `scriptRefusal`). The restructure makes "a call carries a reach, stamped by its surface" the concept. A script's grant becomes one source of a reach and this listener's configuration another, and the invoke core decides both in the one place it already decides grants, at call time and at commit.
   - The reach comes from the deployment (`--reach`, a JSON file in the shape of `CodeGrant`), never from the graph, so a remote caller with write access cannot widen its own reach.
   - Listing follows the reach (Listings are honest).
   - Phase 1's reach: `reads: graph` plus named read actions such as `render.view`, no writes, and **no `outsideRoot` action ever**, whatever the file says.
5. **Attribution.** Writes from this listener record actor `agent` and `via: "mcp-remote:<person>"`, stamped by the wire from the identified person. Reads leave no transaction; their audit is Pomerium's access log.

The phone's proposed device scopes should become a reach too, when that work
starts: one shape for "what may this caller do". The reach is not built by
patching the stdio wire. If generalising the grant proves too large for
phase 1, stop and record a gap rather than adding a second allow-list.

**Request flow, from sign-in to a tool call:**

1. The owner opens Gemini → Developer Mode → Connect to an MCP server and enters `https://<node>.<tailnet>.ts.net/mcp`, leaving the client id and secret empty, so Gemini uses DCR.
2. Gemini's backend reads `/.well-known/oauth-authorization-server` on that origin (Pomerium). Claude would instead `POST /mcp`, get a 401 with `resource_metadata`, and read `/.well-known/oauth-protected-resource`.
3. Registration: Gemini `POST /register` (DCR). Claude and ChatGPT present a CIMD client_id URL on an allow-listed domain.
4. The owner's browser is sent to Pomerium's `/authorize` (PKCE S256, `resource=<mcp url>`). Pomerium redirects to Google sign-in using its own Google OAuth client, whose one redirect URI is on the Funnel host. Google returns an ID token. Pomerium's policy checks that the verified subject is the owner's, then issues a code to the client's redirect (`oauth-redirect.googleusercontent.com/r/…`).
5. Gemini's backend exchanges the code at `/token` and gets a Pomerium access token, audience = the MCP resource, and a rotating refresh token.
6. `POST /mcp` `tools/list` with `Authorization: Bearer <token>`. Pomerium validates the token, re-evaluates the policy, and forwards to `127.0.0.1:<q>/mcp` with `X-Pomerium-Assertion`, a JWT it signs. kb never sees the OAuth token; whether Pomerium strips `Authorization` is *unverified*, and kb ignores it either way.
7. kb verifies the assertion and names the person, then lists `kb.manifest` on the MCP wire under the listener's reach: the read tools, nothing `outsideRoot`, no writes.
8. `tools/call graph_search` passes the reach check in the invoke core, reloads from the store, and returns the receipt. Pomerium logs the request.

## 5. Security model and threats

**Boundary.** Only the owner's Google identity, through Pomerium, reaches kb.
kb verifies the proxy's signature itself, so a process on the box cannot
pose as the proxy. The reach, set in dotfiles, caps what even a valid caller
can do. Anything the owner's AI vendor reads is disclosed to that vendor: that
is the cost of the feature, and it is the reason for the store choice below.

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| 1 | Anyone on the internet calls `/mcp` | Pomerium requires its token, and the policy admits one Google subject. Everything outside `/mcp` and OAuth is 404. Optional: allow only the vendors' published CIDRs | tailscaled TLS and Pomerium are internet-facing; keep both current |
| 2 | Another Google account signs in | The policy pins the owner's subject (`sub`, stable) rather than an email alone | — |
| 3 | **Consent phishing through DCR:** an attacker registers a client with their own redirect and gets the owner to approve a link | Restrict DCR redirect URIs to the three vendors' callbacks, and CIMD to `claude.ai` and `chatgpt.com`. The owner signs in only from the vendor's connect flow | Whether Pomerium can restrict DCR redirects is *unverified*. **Phase-1 blocker** if it cannot |
| 4 | A vendor's stored token leaks (their breach) | Read-only reach. Short access tokens and rotating refresh tokens. Revoke by changing the policy or Pomerium's signing key | The attacker reads the store until revoked |
| 5 | Prompt injection (clipped web pages in kb, chat content) drives tool calls | Phase 1 reads only. Later writes stay inside one subtree; deletes and approval-required actions are refused (MCP carries no approval) | Read results flow back to the same vendor's model, already disclosed |
| 6 | **kb-work leaks** | Different machine. The unit opens one root and has no egress (`IPAddressDeny=any`, loopback only), so it cannot dial `svc:kb-work` even if a bug tried. Private, empty `KB_HOME`, so no Locations. No `outsideRoot` action in any reach. A NixOS check asserts all of this | Removing the policy's wildcard grant is separate hygiene (§7.6) |
| 7 | A local account on shared-server calls `127.0.0.1:<q>` | It needs an assertion signed by Pomerium's key. Root can do anything (both people are in `wheel` with passwordless sudo, a known dotfiles gap) | Root on the box |
| 8 | Registration spam (DCR is open) | Registration grants nothing without the owner's sign-in. Pomerium's storage bounds it | Storage growth *(unverified)* |
| 9 | Load and cost (expensive `graph.query`) | Funnel's bandwidth cap. The unit's `CPUQuota`/`MemoryMax`. Pomerium has no rate limiter *(unverified)*, so systemd limits are the floor | Self-inflicted slowness of app-kb on the same store |
| 10 | Host is discovered (CT logs list `*.ts.net` names) | Expected; every probe gets 401 or 404 | The node and tailnet names are public |
| 11 | Token passthrough / confused deputy | kb never receives OAuth tokens. Pomerium's tokens are audience-bound to the MCP host [S1] | — |
| 12 | Secrets and host state reachable through kb | The unit's `KB_DATA` is private and empty: no host secrets, trust ledger or installed extensions | — |

**Token lifetime and revocation.**

- Lifetime: Pomerium issues access tokens and rotates refresh tokens for public clients [P1]. Aim for access tokens of at most an hour and a session of at most 30 days, so the owner signs in again monthly. Pomerium's exact settings are *unverified*.
- Revoking one client: disconnect it in the vendor's UI.
- Revoking all clients: rotate Pomerium's signing key and session secret. That invalidates every token and every assertion, because kb pins the public key.
- Stopping the service: §6, "Off switch".

## 6. Build plan

Each phase is one PR per repository. The kb PRs land first; dotfiles then
pins the new kb.

**Phase 0 (owner, no code).** Confirm Gemini Developer Mode's "Connect to an
MCP server" is offered on the owner's account. Google documents custom apps as
US-only, for personal accounts [G1]. If Gemini is not offered, start with
claude.ai. Create a Google OAuth client (type Web, free) whose single redirect
URI is Pomerium's callback on the Funnel host. Its secret goes into machine
state.

**Phase 1a — kb, restructure (behaviour-preserving): `refactor: a call's reach, of which a script's grant is one`.**

- Change: generalise `ActionInvocation.script` to a reach stamped by the surface, with `scriptRefusal` and `scriptWriteRefusal` deciding any reach. Update DESIGN.md → Grants.
- Accepts: `script-run.test.ts`, `sandboxContract` and the surface contract pass unchanged. Typecheck and lint pass.

**Phase 1b — kb: `feat: MCP over Streamable HTTP with a signed-assertion identity`.**

- `kb mcp --listen`, `--assertion`, `--reach` (§4). DESIGN.md → Surfaces (MCP) and Who the person is updated in the same commit. Wire fingerprint recorded.
- Accepts:
  - the surface contract gains the HTTP MCP row, and its listing equals stdio's under a full reach;
  - no assertion → 401; bad signature, wrong audience, expired token or unknown subject → 401;
  - read-only reach: `node_add` is not listed, and calling it is refused `forbidden`;
  - no `outsideRoot` tool is listed under any reach file;
  - `GET /` and `/api/action` → 404;
  - a test pins that the listener opens exactly its `--root`.

**Phase 1c — dotfiles: `feat(kb): public MCP for the personal store`.**

- Pieces:
  - `my.stacks.kb.stores.<store>.remoteMcp = { enable; subject; reach; }` produces the `kb-remote-mcp` unit with the sandbox in §4;
  - a new `modules/stacks/mcp-gateway` wraps nixpkgs `services.pomerium`: Google IdP, an `mcp: server` route to the unit, a CIMD allow-list, and DCR restricted to vendor redirects;
  - the vpn stack gains a declared Funnel, a oneshot running `tailscale funnel --bg --https=443 http://127.0.0.1:<p>` (no NixOS module covers Funnel);
  - `policy.hujson` gets `nodeAttrs: [{target: ["tag:shared-server"], attr: ["funnel"]}]`, and `check-tailscale-policy.sh` learns that Funnel is declared, never ad hoc;
  - secrets (Google client secret, Pomerium shared secret and signing key) follow the existing machine-state file pattern through `LoadCredential=`.
- Accepts:
  - from outside the tailnet, `curl -i …/mcp` → 401 with discovery headers; `/.well-known/oauth-protected-resource` is JSON; `/` → 404;
  - a NixOS check: the unit has `IPAddressDeny=any`, its `KB_HOME` holds no Locations, and its `--root` is the personal store;
  - **Gemini lists kb's tools after a Google sign-in**, and `graph_search` answers;
  - signing in with a second Google account is denied.

**Phase 2 — dotfiles: claude.ai and ChatGPT.**

- Change: enable CIMD for their domains, and confirm 401 discovery and the `resource` match for Claude.
- Accepts: each lists the tools. ChatGPT Pro is read/fetch only by plan [O4].

**Phase 3 (only if the owner wants writes) — kb then dotfiles: `feat: remote writes bounded to one subtree`.**

- Change: the reach names a subject, such as a "From AI" node, plus `node.add` and `node.update`. A write outside the subject is refused at commit (the grant's existing bound). Destructive and approval-required actions stay unlisted until MCP elicitation closes gap `01M3R2KD6V1AZ9WS62ZVG9T4G2`.
- Accepts: the grant tests run over the remote wire, and `graph.changes` shows `via: mcp-remote:<person>`.

**Off switch.**

- Declared: `remoteMcp.enable = false`, or removing the Funnel declaration (the reconcile runs `tailscale funnel reset`), then rebuild.
- Immediate, until the next rebuild: `sudo tailscale funnel reset` or `systemctl stop kb-remote-mcp`.
- The unit and Pomerium are separate from `app-kb`, so turning them off never touches the owner's UI.

## 7. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| 1 | Exposure and broker: Funnel + Pomerium ($0), or Cloudflare Tunnel + Access (domain ~$10/yr, a paid item; Cloudflare terminates TLS) | **Funnel + Pomerium.** Fall back to Cloudflare if Pomerium fails the phase-1c spike (threat 3, or behaviour behind Funnel) |
| 2 | Phase-1 scope: read-only across the whole personal store | **Yes.** Every read tool, no writes, no `outsideRoot` |
| 3 | Writes later? | **Only into one "From AI" subtree, add and update, no deletes**, or never. Approval-required actions stay off until MCP elicitation exists |
| 4 | Where the ceiling (reach and admitted subject) lives | **Dotfiles (deployment configuration)**, never the graph, so a remote caller cannot widen it |
| 5 | Secrets: the existing machine-state file pattern, or adopt sops-nix now | **Existing pattern** via `LoadCredential=`; sops-nix as its own change |
| 6 | Tailnet hygiene: drop the wildcard `*`→`*` grant | **Yes, as a separate dotfiles PR.** Not required here (threat 6 holds without it), but it makes the declared grants real |

## 8. Unverified

- Which plans and regions can use Gemini **Developer Mode**. Custom apps are US-only [G1]. Whether Gemini follows PRM at all. Reports of Gemini stopping after the OAuth callback (forum threads discuss.ai.google.dev/t/186405, /t/177327).
- Pomerium behind Funnel, with TLS terminated by tailscaled and Pomerium on `insecure_server`. The name and default of Pomerium's inbound DCR flag. **Whether DCR redirect URIs can be restricted.** Whether 0.33 still needs `runtime_flags.mcp`. Whether `Authorization` is stripped before the backend. The name of the signing-key file option. Token lifetime settings. Rate limiting.
- Whether Funnel can serve a Tailscale Service name rather than the node's. Funnel's bandwidth figure.
- Whether all three clients accept a stateless Streamable HTTP server (no `Mcp-Session-Id`).
- Cloudflare Access Managed OAuth and CIMD. Whether a Tunnel origin satisfies "served through Cloudflare".
- sigbit/mcp-auth-proxy's DCR/CIMD support and its nixpkgs status.
- ChatGPT Plus access to custom MCP; sources conflict.
- How Google's terms treat content Gemini reads through a connector (retention, human review). This is for the owner to read before phase 1c.

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
- [T1] tailscale.com/kb/1223/funnel and tailscale.com/kb/1312/serve ("Funnel traffic … does not include identity headers")

Pomerium:
- [P1] pomerium.com/docs/capabilities/mcp/reference
- [P2] pomerium.com/changelog (Jan 2026: CIMD; Jul 2026: DCR, `iss`). nixpkgs `services.pomerium`, package 0.33.4

Cloudflare:
- [CF1] developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/
- [CF2] cloudflare.com/plans/sase-zero-trust

VPS:
- [V1] hetzner.com/cloud/cost-optimized
- [V2] docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm

Google Cloud:
- [GC1] docs.cloud.google.com/run/docs/ai/authenticate-mcp-servers

Other brokers:
- [OP1] github.com/oauth2-proxy/oauth2-proxy/issues/3167
- [K1] keycloak.org/securing-apps/mcp-authz-server
- [M1] github.com/sigbit/mcp-auth-proxy
