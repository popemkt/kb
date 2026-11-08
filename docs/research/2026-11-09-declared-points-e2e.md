# Installed declared points: end-to-end evidence

Date: 2026-11-09. The backend implementation is committed alongside this
record. Sample source: [`popemkt/kb-extensions` at
`20a4e142a98ebfbc3d96af79261494cd97aee182`](https://github.com/popemkt/kb-extensions/tree/20a4e142a98ebfbc3d96af79261494cd97aee182).

The real CLI installed two separate GitHub trees into scratch stores, with
scratch `KB_HOME` and `KB_DATA`. A test fixture supplied the person's trust
through `CodeTrust` in that scratch profile only; no approval bypass or
change to the product's trust flow was added. The ordinary person-facing
flow remains `kb ext trust` at a terminal after review.

The owner imports only `kb-ext-sdk`, declares `ext.quotes.sources` with a
Standard Schema contract, and reads it through `ctx.contributions`. The
contributor imports only `kb-ext-sdk`, restates its value type, lists the
point in `uses`, and resolves it through `ctx.point`. Neither imports the
other extension.

Paths below are shortened to `$BOTH` and `$ALONE`. Both stores share the
same scratch trust profile, so the identical contributor digest is already
trusted in the second store.

```text
$ kb --root $BOTH --json ext install github:popemkt/kb-extensions/extensions/quote-source@20a4e142a98ebfbc3d96af79261494cd97aee182
succeeded; quote-source; trusted=false
$ kb --root $BOTH --json ext install github:popemkt/kb-extensions/extensions/quotes@20a4e142a98ebfbc3d96af79261494cd97aee182
succeeded; quotes; trusted=false

trust fixture: quote-source sha256:630dfa80f999844ced29e15c476771beee4ca453f34c496b4aaee1dabde4a82d
trust fixture: quotes sha256:ca721ae659d523cfe31962ea504d72dc24369fe2be8e9e2539a0ff48b46bb71f

extension.list point:
{"point":"ext.quotes.sources","owner":"quotes","spec":{"cardinality":"list","combine":"all sources in contribution order","kernel":"registry","tier":"T0"},"source":"registry","listeners":[{"owner":"quote-source","id":"ext.quote-source.example"}]}

$ kb --root $BOTH --json action-invoke '{"id":"ext.quotes.list","input":{}}'
{"status":"succeeded","id":"ext.quotes.list","output":[{"text":"A point connects independent plugins.","author":"kb sample"}]}

$ kb --root $ALONE --json ext install github:popemkt/kb-extensions/extensions/quote-source@20a4e142a98ebfbc3d96af79261494cd97aee182
succeeded
extension.list contributor:
{"name":"quote-source","uses":[{"point":"ext.quotes.sources","from":null}],"failures":[],"loadFailures":[]}

$ kb --root $ALONE ext list
waiting for point ext.quotes.sources
```

The committed integration suite also exercises real installed locks and
contained source trees with a deterministic Git reader. Kernel contracts
prove owner removal and return, failed-owner cleanup, namespace authority,
wrong-host declaration refusal, forged and retired key refusal, and sync
and async contribution decoding.
