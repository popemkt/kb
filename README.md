# kb

kb is a graph datastore that lives in your repository. Every fact is a node
in `.kb/nodes.jsonl`, committed beside the code it is about: todos, gaps,
rules, notes, and the fields and tags that describe them, which are nodes
too. You read and write it from the command line, an MCP server, or a
browser UI that projects the same graph as an outline, tables, boards, a
canvas and visual graphs, and you query it with datalog.

Because the store is a file in git, it branches, merges and reviews with
the code. kb ships its own merge driver, which merges `nodes.jsonl` by node
id rather than by line. Generated markdown views keep a readable copy of
selected data (this repository's [`docs/rules.md`](docs/rules.md) and
[`docs/todos.md`](docs/todos.md)), and checks hold the data honest: every
rule's home resolves, and every `GAP [[id]]` marker in the code names an
open gap.

This repository is kb's code and its first user: kb's own design
decisions, gaps and rules are in its `.kb/`.

## Install

kb runs on [Bun](https://bun.sh). Pick one of three ways:

- **A release bundle.** Download `kb-<version>.tar.gz` from
  [Releases](https://github.com/popemkt/kb/releases), check it against its
  `.sha256`, unpack it, and put `kb-<version>/bin` on your `PATH`. The
  launcher runs the bundled CLI on the `bun` already on your `PATH`.
- **Nix.** `nix profile install github:popemkt/kb` installs `kb` with its own
  Bun. In a flake, add `inputs.kb.url = "github:popemkt/kb"` and use
  `kb.packages.${system}.kb`. It is built for aarch64-darwin, x86_64-linux
  and aarch64-linux.
- **From source.** Clone this repository, run `bun install`, and use
  `bin/kb`, which runs the CLI from the checkout.

## Use

```bash
kb init                          # create .kb/ here (--bare: no example content)
kb add "Fix drift audit" --tag todo --prop status=doing
kb search "drift"
kb query '[:find ?id ?text :where [?n :node/text ?text] [?n :node/id ?id]]'
kb ui                            # the browser UI on 127.0.0.1:4321
kb mcp                           # the MCP server, on stdio
kb --help                        # everything else
```

Every command finds its store by walking up from the working directory to
the nearest `.kb/`, or takes `--root <path>`. `--json` gives machine output.

A repository that keeps a store gates it with:

```bash
kb docs check                    # generated docs match the data (kb docs materialize rewrites them)
kb check audit                   # every #rule's home resolves and every #check is wired
git ls-files -z | kb check gaps --files-from -   # every GAP [[id]] marker names an open gap
```

Register the merge driver once per clone:

```bash
git config merge.kb-jsonl.name "kb node store (three-way by node id)"
git config merge.kb-jsonl.driver "kb merge-jsonl %O %A %B %P"
echo '.kb/nodes.jsonl merge=kb-jsonl' >> .gitattributes
```

## Develop

```bash
nix develop        # optional: the Bun, jq, shellcheck and actionlint the gates use
bun install        # one lockfile for the whole workspace
bun run setup      # once per clone: the pre-commit hook and the merge driver
```

Then:

```bash
bun run verify      # the gate: typecheck, lint, format, harness, check audit, gap markers
bun run test        # bun test, every package but the browser ones
bun run test:ui     # Vitest, the scope:browser packages
bun run test:dst    # deterministic simulation sweep
bun run test:render # real-browser render specs (bunx playwright install chromium first)
```

`verify` is the one name for the toolchain gate; what it runs is its
definition in `package.json`. The pre-commit hook runs it, and the
generated-docs check, against the staged index rather than the working
tree. CI runs the same, plus the suites and the Nix build; what triggers
what is in [`docs/ci.md`](docs/ci.md).

kb is a Bun workspace: every concept is a package under
`packages/<layer>/<name>`, named `@kb/<name>`. Bun is the production
runtime; the toolchain is TypeScript 7, Vite+, oxlint and Nx, and the code
is written in Effect v4. Two test runners split by package: every
`scope:browser` package runs on Vitest, everything else on `bun test`.

Before changing code, read [`AGENTS.md`](AGENTS.md): it holds the
engineering rules this repository is held to (Rule 1, one contract for
every implementation, canonical statements, drift markers and gaps) and the
working notes for agents and people alike.

### External extension types

```bash
kb ext sdk --write   # writes .kb/sdk.d.ts matching this kb binary
```

```ts
/// <reference path="../sdk.d.ts" />
import type { ExtensionAction } from "kb-ext-sdk";

const actions: ExtensionAction[] = [/* … */];
export default actions;
```

No repo-relative imports, no npm install of kb. Regenerate the embedded
string after changing `packages/contract/ext-sdk/src/surface.ts`: `bun run gen:ext-sdk`.

## Documentation

- [DESIGN.md](DESIGN.md): the model, the store, the query layer, the plugin
  kernel, extensions, and the workspace's shape and tooling.
- [DESIGN-UI.md](DESIGN-UI.md): the browser UI and its interaction contracts.
- [DESIGN-REFINE.md](DESIGN-REFINE.md) and [DESIGN-RESKIN.md](DESIGN-RESKIN.md):
  the refinement and reskin passes.
- [AGENTS.md](AGENTS.md): the engineering rules and the working notes.
- [docs/ci.md](docs/ci.md): what the hook and CI check, and why.
- `docs/waves/`, `docs/research/`, `docs/brainstorms/`: the records of how kb
  got here.

## History

kb was developed inside [`popemkt/mac-backup`](https://github.com/popemkt/mac-backup)
until 2026-10-18, under `tools/kb/`, and moved here with its history. A
commit SHA cited in a record from before that date refers to
`popemkt/mac-backup`'s history, not this repository's.

## Releasing

`package.json`'s `version` is the one source: `kb --version` prints it, and a
release tag must equal `v<version>`, or `.github/workflows/release.yml` fails.

```bash
bun run release 0.3.0            # set the version, regenerate the SDK module, commit, tag v0.3.0
git push origin HEAD:main v0.3.0 # the tag push builds, smoke-tests and publishes the release
```

The release is one platform-independent bundle, `kb-<version>.tar.gz` with its
`.sha256`. It unpacks to `kb-<version>/bin/kb`, a launcher that runs the bundled
CLI on the `bun` on PATH, beside `lib/kb/` (the CLI and the UI it serves).
`bun run release:bundle` builds it into `out/`. `bun run release:smoke
out/kb-<version>.tar.gz` runs the same smoke test CI runs. A manual run of the
workflow is a dry run: it uploads the bundle as a workflow artifact and
publishes nothing.
