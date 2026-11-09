# Transaction reactions: installed sample proof

2026-11-09. Step 10 of [extensibility parity](2026-11-08-extensibility-parity.md).
The live promise is [Transaction reactions](../../DESIGN.md#transaction-reactions).

Source: `popemkt/kb-extensions`, `extensions/inbox-router`, revision
`32387cbca54c7d65b9d4d8bee92cac5b1e68e02c`. It imports only `kb-ext-sdk`.
The marketplace entry waits for the backend merge; its workflow must then pin
that surviving kb commit.

A fresh Git repository under `/tmp/kb-inbox-e2e-W6axCv/root` used scratch
`KB_HOME`, `KB_DATA` and `XDG_CACHE_HOME`. The source was installed from GitHub,
not linked. A test fixture trusted its reviewed digest in that scratch profile
only; it did not approve code in the person's profile.

```text
$ kb ext install github:popemkt/kb-extensions/extensions/inbox-router@32387cbca54c7d65b9d4d8bee92cac5b1e68e02c
succeeded; trusted: false
files: sha256:9c6c1f9726c68a06d44d70a3ecf4a66acd6889950c26721439c5e6f56e046b69
digest: sha256:4d01904ac71cf82cfe5113c3be57bca1a324ad8a985203c70de648f5273ea46e
untrusted: source installed; callback inactive
trust fixture (scratch profile only): inbox-router [digest above]
$ kb add "CLI routed node" --id inbox-cli-proof --tag ext.inbox-router.inbox-tag
succeeded
$ kb get ext.inbox-router.inbox
children: [{id: inbox-cli-proof, text: "CLI routed node", ...}]
```

A real Chromium page opened the Inbox in the running `kb ui` server. From that
page, a same-origin POST to `/api/action` added `inbox-ui-proof`, tagged with the
sample's inbox tag. The returned receipt was successful at revision 8. The
ordinary outline showed both routed children. No page half or new UI control
was involved.

```text
page node.add: succeeded; id: inbox-ui-proof; rev: 8
$ kb action-invoke '{"id":"graph.changes","input":{"since":0}}'
rev 5: actor cli; wrote inbox-cli-proof
rev 6: actor {kind: reaction, id: ext.inbox-router.route}; wrote Inbox + inbox-cli-proof
rev 7: actor human; wrote inbox-ui-proof
rev 8: actor {kind: reaction, id: ext.inbox-router.route}; wrote Inbox + inbox-ui-proof
PASS: CLI and live page writes route before responding; reaction transactions identify inbox-router.
```

Evidence retained in the builder thread:
`/tmp/kb-parity-inbox-e2e.log`, `/tmp/kb-parity-inbox-e2e.ts`, and
`step10-inbox-router.png` under its thread storage. The shared reaction contract
runs over JSONL and SQLite; the live install proof used the default JSONL store.
MECE finding 2 is closed by this implementation. The broader lifecycle idea
`01M540F8MHVT0K9VRDCCE1WHBZ` stays open: session-start hooks are outside this step.
