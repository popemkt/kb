# Rust→WASM in kb: a 50k profile, three TypeScript fixes, and one experiment (research, for the owner to read)

Date: 2026-10-31. Base: `main` at `ca5b448`. This record measures and
recommends. It reports four PRs and merges none of them:

- [#75](https://github.com/popemkt/kb/pull/75), [#76](https://github.com/popemkt/kb/pull/76)
  and [#77](https://github.com/popemkt/kb/pull/77) are the TypeScript fixes (Part A);
- [#78](https://github.com/popemkt/kb/pull/78) is the Rust→WASM experiment (Part B).

The owner's plan, as relayed:

1. do not port kb;
2. measure first;
3. fix the algorithmic slow paths in TypeScript;
4. run one Rust→WASM experiment behind a kb contract;
5. consider WASM component plugins later, if that pays.

It links to the specs that own each mechanism and does not restate them:

- storage and the commit: [DESIGN.md → Storage](../../DESIGN.md#storage-horizontal);
- the index and DataScript: [DESIGN.md → Query layer](../../DESIGN.md#query-layer-horizontal);
- the sandbox: [DESIGN.md → Sandbox](../../DESIGN.md#sandbox);
- extensions: [DESIGN.md → Core boundary & extensions](../../DESIGN.md#core-boundary--extensions);
- plugin dependencies: [`2026-10-29-plugin-codependency.md`](2026-10-29-plugin-codependency.md);
- the earlier 50k measurements: [`2026-10-28-visual-reference-gallery.md` §7](2026-10-28-visual-reference-gallery.md).

## 0. The answer

**Don't adopt Rust→WASM now.** If it is adopted later, adopt it for one
thing only: the query worker's join kernel, and only once a TypeScript
columnar index has shipped and a profile still shows the join on top.

Most of what made kb slow at 50k nodes was algorithmic, and TypeScript fixes
it.

- A single-node save read and rewrote the whole store.
- The server diffed the whole graph after its own writes.
- `/api/graph` re-validated and re-serialised 44 MB on every request.

The three Part A PRs take a 50k save from 1.38 s to 0.41 s on JSONL, and
from 0.70 s to 0.10 s on SQLite. They take a repeat `/api/graph` from 2.2 s
to 94 ms.

What remains CPU-bound is the DataScript index: about 2.8 s to build at 50k,
and 150–760 ms per cold query. The experiment shows that most of that cost
is _representation_, not language. DataScript holds boxed ClojureScript
datoms in persistent sorted sets; the experiment holds interned integer
columns in typed arrays. The same columnar kernel performs as follows:

| kernel                    | build vs DataScript | cold queries vs DataScript                                                                                                    |
| ------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                | 2.8× faster         | 3–80× faster                                                                                                                  |
| Rust→WASM, same algorithm | about 3.2× faster   | about 2–2.5× faster again on join-heavy queries; 1.1–1.25× again on the index build in Bun, and none on the build in Chromium |

A 2.5× gain on a query that already costs 100 ms at 50k does not yet pay
for what Rust costs kb:

- a second language;
- 1.8 GB of toolchain closure;
- a hand-kept numeric ABI across the boundary;
- committed build artifacts, and a reproducibility gate to keep them honest.

WASM component plugins are a coherent second sandbox (§6). They answer a
question kb does not have yet: untrusted guests written in languages other
than JavaScript.

## 1. The profile at 50k

### Method

- **Host.** shared-server: 16 cores, 30 GB RAM, other agents' runs
  alongside. Read the numbers as indicative, not lab-grade.
- **Stores.** The gallery bench stores: N visuals plus about 925 schema,
  facet and style nodes. Each visual has 3–6 style refs over 600 styles in
  10 facets. That is about 22 datoms per visual: 1.1 M datoms at 50k.
  The JSONL file is 42 MB.
- **Harnesses.** In-process harnesses for open, save, query and search, with
  `bun --cpu-prof` plus a phase attribution over the profile. For the page,
  headless Chromium with CDP timing. Neither harness is committed: both
  read scratch stores outside the repository.

### Where the time went, before Part A (50k, JSONL unless noted)

| scenario                                                       |        time | split by phase                                                                                                                                                       | kind                                                       |
| -------------------------------------------------------------- | ----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| store load (`loadEffect`)                                      |      0.62 s | read 0.07 s; parse and Schema decode ~0.55 s                                                                                                                         | constant: decode per node                                  |
| open (`openKbEffect`)                                          |   3.5–5.8 s | DataScript `init_db` 2.7–2.8 s; load 0.62 s; tx-tail parse 0.5 s                                                                                                     | **CPU-bound**: the index build                             |
| server ready (`kb ui`)                                         |   4.2–4.8 s | the open, plus the HTTP routes                                                                                                                                       | as above                                                   |
| one save (`node.update`, in process)                           |      1.38 s | decode the store ~0.58 s; serialise every node ~0.43 s; SHA-256 ×3 ~0.16 s; `rankTx` over the whole set ~0.07 s; integrity check ~0.08 s; fs write and fsync ~0.05 s | **algorithmic**: O(N) per write                            |
| one save (`node.update`, in process), SQLite                   |      0.70 s | decode every row ~0.58 s; `rankTx` ~0.06 s; integrity check ~0.08 s                                                                                                  | **algorithmic**                                            |
| one save over HTTP, JSONL                                      |   1.5–2.3 s | the in-process save, plus about 0.6 s ingesting the server's own write (copy the graph, reload, `diffTx` of 2×N canonical JSON)                                      | **algorithmic**                                            |
| `/api/graph` (every request)                                   |   1.9–2.2 s | zod over every node ~0.53 s; zod over the whole again ~0.55 s; `JSON.stringify` of 44 MB ~0.53 s; brotli ~0.17 s                                                     | **algorithmic**: per request, not per state                |
| page: navigation → first rendered row                          |   4.3–4.5 s | `/api/graph` ~1.9 s; parse and replica plus the worker's DataScript build ~2 s; render under 0.1 s                                                                   | network and parse; whole-graph transfer                    |
| datalog query: visuals of the tag, cold                        |  150–260 ms | DataScript `q`                                                                                                                                                       | **CPU-bound**                                              |
| `graph.search`, in process                                     |    14–17 ms | the node-table text scan                                                                                                                                             | fine                                                       |
| `kb search`, `kb get`, `kb docs check`, `kb check audit` (CLI) | ~5.0 s each | almost all of it is the open: each command loads the store and builds the index                                                                                      | algorithmic per invocation: every command opens everything |
| `kb ext validate`                                              |      0.41 s | does not open the graph                                                                                                                                              | fine                                                       |

The repository's own `kb check audit` (955 nodes) takes 0.55 s. `bun run
verify` is a repository gate, not a store operation, so the "`kb verify`"
in the brief is read here as the store-reading gates above.

## 2. Part A: the algorithmic fixes, in TypeScript

Each PR has its own before and after table, measured the same way. None is
merged; the parent thread decides.

### [#75](https://github.com/popemkt/kb/pull/75) — the echo of a session's own commit costs nothing to ingest

`reloadEffect` now answers the nodes it replaced, or `null` when the session
was already current. The server's ingest therefore compares against the
state it actually held, and does not touch the graph when nothing moved.

| save over HTTP |  before |   after |
| -------------- | ------: | ------: |
| JSONL 50k      | 2188 ms | 1614 ms |
| SQLite 50k     | 1276 ms |  693 ms |

### [#76](https://github.com/popemkt/kb/pull/76) — the graph is built once per state of the session

- The snapshot and its JSON are kept per (index generation, log head).
- The ETag names that state, and a client holding it gets `304`.
- The kept body keeps its brotli encoding.

|                                   |  before |   after |
| --------------------------------- | ------: | ------: |
| repeat `/api/graph`, 50k          | 2223 ms |   94 ms |
| page: navigation → first row, 50k | 5217 ms | 2384 ms |

### [#77](https://github.com/popemkt/kb/pull/77) — a commit on the state a store kept does not read the store

The PR lands as three commits: the spec, a behaviour-preserving restructure,
then the behaviour.

- **`rankTx` is local.** It reads a `RankBase` overlay, so it costs the
  sibling groups it touches.
- **`StoreState` is the node set a store holds.** Each adapter keeps it
  under its fingerprint through one `KeptState`.
- **JSONL keeps each node's line.** A commit writes only what moved, then
  joins.
- **A new contract property, run by every adapter.** A commit after another
  writer's commit merges into what that writer left.

| `node.update`, in process |         1k |         10k |           50k |
| ------------------------- | ---------: | ----------: | ------------: |
| JSONL before → after      | 50 → 25 ms | 276 → 78 ms | 1378 → 413 ms |
| SQLite before → after     |  25 → 6 ms | 142 → 17 ms |   696 → 98 ms |

### Named, not done

Each is smaller, or belongs to an existing gap:

- **The session's integrity check.** `txIntegrityError` and the `ctx.nodes`
  copy still read the whole graph: about 75 ms at 50k. Making it local is
  the same move as `rankTx` (a parent map and a cycle walk over what the
  transaction touches).
- **The JSONL floor.** Hashing the 42 MB file three times and rewriting it
  costs about 185 ms. That is the format's contract (one sorted file,
  replaced whole, fingerprinted by content). At this size SQLite is the
  answer.
- **The first `/api/graph` after a change** still pays the whole build,
  about 2 s at 50k. The zod double-parse alone is about 1.1 s. That cost
  belongs to the whole-graph gap (`01M1M08XEH901FXF4MRKJKCSQA`).
- **CLI commands open everything.** About 5 s per command at 50k. Reusing a
  running `kb ui`, or opening lazily, would close it.
- **The tx-tail parse at open**, about 0.5 s with large records.

## 3. Part B: the experiment

### What was picked, and why

After Part A, the largest CPU-bound cost on every path a person waits on is
the DataScript index:

- the build at open, 2.7–2.8 s, paid by the server and again by the page's
  query worker;
- a cold query, 150–760 ms.

It is pure computation over flat data. It runs in both runtimes, Bun and the
page's worker. Its inputs and outputs can cross a boundary as typed arrays.
That made it the one hot path where WASM could show its best case.

### The contract

The contract is one concept with two implementations, as the AGENTS.md rule
"One contract, every implementation" requires.

- **The encoding.** `@kb/query` `kernel/contract.ts` encodes kb's datoms
  as four columns:
  - `e`, the eid (`Uint32Array`);
  - `a`, the interned attribute (`Uint32Array`);
  - `t`, a value tag of num, str, bool or other (`Uint8Array`);
  - `v`, the number or interned index (`Float64Array`).

  It encodes a conjunctive query as a `Float64Array` of
  (entity term, attribute, value term) patterns, plus the find vars and an
  optional count.

- **The kernel.** A `DatomKernel` builds a `KernelIndex`, and `run(query)`
  answers row-major cells.
- **The algorithm.** Two sorted permutations (EAVT, AVET), binary-search
  range scans, and a left-to-right index nested-loop join. Rows are
  deduplicated on what the query finds, as DataScript's set semantics do.
- **The two implementations.**
  - `tsKernel` is TypeScript.
  - `@kb/datom-kernel-wasm` is the same algorithm in Rust, line for line
    where the languages allow, so the comparison measures the language and
    runtime and not two designs.
- **The suite.** `datomKernelContract` (`@kb/test-kit`) runs over both. Each
  must answer a query corpus exactly as DataScript does, over fast-check
  graphs shaped like a library. The corpus covers:
  - tag membership;
  - a two-style filter;
  - counts per style;
  - backlinks by mention;
  - a parent's children with their text;
  - a number constant;
  - a count of everything;
  - a constant no datom holds.

Both kernels pass.

**Scope, honestly.** The kernel answers conjunctive patterns only. It has no
rules, predicates, `or`/`not`, pull, functions or incremental transact, all
of which kb's datalog uses. It is a measurement, not a replacement.

### wasm-bindgen, not the component model

The kernel must run in Bun and in the page today.

- **wasm-bindgen (`--target web`)** emits a plain ES module plus a core wasm
  module. Both runtimes instantiate it with `initSync`, and the package
  stays `scope:shared` (no `node:*`; the caller supplies the bytes).
- **The boundary is four methods over typed arrays**, so wasm-bindgen's
  generated glue is small (9.5 KB) and carries no serialisation.
- **The component model would need jco** to transpile the component back
  into a core module plus JS glue. The prior-art survey found jco's browser
  support marked experimental, and found no evidence of it on Bun. A
  component's value is a typed, capability-shaped interface between parties
  that do not trust each other. That fits plugins (§6), not an internal
  kernel.
- **Version pinning.** The crate pins `wasm-bindgen = "=0.2.127"` to
  nixpkgs' `wasm-bindgen-cli`, because the CLI must equal the crate
  version.

### Speed

Medians.

- **DataScript queries are cold.** The index keeps answers by their EDN
  string, so each run uses a distinct string. A repeated query costs
  nothing on any engine. DataScript's times include parsing the EDN.
- **Kernel times include the round trip:** `encodeQuery`, the run, and
  `decodeRows`, which looks the strings back up.
- **Build is DataScript `new DatascriptIndex(nodes)`** against the kernels'
  `datomsOf` + `encodeDatoms` + `build`. `datomsOf` is kb's own
  `nodeToDatoms`, the same work DataScript's build starts with.

**Bun 1.4.2**

| 50k (1.11 M datoms)                               | DataScript |           TS kernel |          Rust→WASM |
| ------------------------------------------------- | ---------: | ------------------: | -----------------: |
| build (datoms 359 + encode 134 + index)           |    2885 ms | 1014 ms (index 521) | 911 ms (index 418) |
| every visual of the tag (50k rows)                |     148 ms |               36 ms |              19 ms |
| two-style filter                                  |      39 ms |             0.60 ms |            0.29 ms |
| style counts over the tag (≈225k join rows → 600) |     763 ms |              255 ms |             100 ms |
| a facet's children and their text                 |      19 ms |             0.06 ms |            0.04 ms |
| count of everything                               |      62 ms |               11 ms |             9.7 ms |

| 10k (229k datoms)   | DataScript |         TS kernel |         Rust→WASM |
| ------------------- | ---------: | ----------------: | ----------------: |
| build               |     526 ms | 201 ms (index 94) | 181 ms (index 74) |
| every visual        |      26 ms |            7.0 ms |            3.4 ms |
| two-style filter    |     8.7 ms |           0.11 ms |           0.04 ms |
| style counts        |     152 ms |             42 ms |             19 ms |
| facet children      |     3.6 ms |           0.06 ms |           0.04 ms |
| count of everything |      10 ms |            2.4 ms |            2.0 ms |

| 1k (31k datoms)     | DataScript |         TS kernel |         Rust→WASM |
| ------------------- | ---------: | ----------------: | ----------------: |
| build               |      66 ms | 21 ms (index 9.8) | 20 ms (index 8.2) |
| every visual        |     4.6 ms |            1.2 ms |           0.63 ms |
| two-style filter    |     1.2 ms |           0.03 ms |           0.02 ms |
| style counts        |      20 ms |            5.7 ms |            2.0 ms |
| facet children      |    0.86 ms |           0.06 ms |           0.03 ms |
| count of everything |     2.4 ms |           0.74 ms |           0.40 ms |

**Chromium (headless, via Playwright; the page bundle built by `Bun.build`)**

The browser coarsens its timer to 0.1 ms, so cells under 0.1 ms read as
"<0.1".

| 50k                                    | DataScript |          TS kernel |          Rust→WASM |
| -------------------------------------- | ---------: | -----------------: | -----------------: |
| build (datoms 294 + encode 65 + index) |    2033 ms | 813 ms (index 454) | 838 ms (index 479) |
| every visual                           |     141 ms |              43 ms |              18 ms |
| two-style filter                       |      42 ms |             0.4 ms |             0.2 ms |
| style counts                           |     739 ms |             223 ms |              95 ms |
| facet children                         |      18 ms |             0.1 ms |            <0.1 ms |
| count of everything                    |      56 ms |              17 ms |             9.8 ms |

At 10k and 1k Chromium tracks Bun within about 25% on every cell above 1 ms; the
benchmark script prints all three sizes. In Chromium the WASM index build is
no faster than TypeScript's: V8's typed-array sort with a comparator
matches Rust's `sort_unstable_by` across the boundary.

**Reading it.**

1. **Representation is the big win, and it is available in TypeScript.** The
   columnar kernel is 3–80× faster than DataScript on queries, and 2.5–2.8×
   faster to build.
2. **The language win is real but bounded.**
   - It is 1.9–2.6× on join-heavy queries, where the work is tight loops
     over typed arrays plus a dedup hash.
   - It is about 1.0–1.25× on the build, which is a comparator sort either
     way.
   - Ratios near 1 on tiny queries are the boundary crossing.
3. **The TypeScript kernel is unoptimised.** It deduplicates rows on string
   keys. Mozilla's source-map library is the cautionary precedent: a Rust
   rewrite was about 5.9× faster, and then optimised JavaScript closed most
   of that gap. This record did not chase that, and it is the first open
   question.

### Size, and the eager bundle

| artifact                                                      |     raw | gzip -9 |
| ------------------------------------------------------------- | ------: | ------: |
| `datom_kernel_bg.wasm` (after `wasm-opt -O3`; 68.6 KB before) | 47.4 KB | 17.5 KB |
| `datom_kernel.js` (wasm-bindgen glue)                         |  9.5 KB |  2.4 KB |
| DataScript (`datascript.js`), for scale                       |  467 KB |  101 KB |

**The eager bundle cost is zero.** DataScript is already the query worker's
alone, and `page-bundle.test.ts` proves no eager chunk carries it (DESIGN-UI
→ Replica queries). A kernel would live in the same worker and load with it.
If a kernel ever replaced DataScript there, the worker would shrink by about
80 KB gzip. It cannot replace it until it covers kb's whole datalog, though.

## 4. Build, CI and the developer loop

|                                                                                | measured on shared-server                            | CI estimate (GitHub `ubuntu-latest`, 4 vCPU)                                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| toolchain (`nix develop .#wasm`)                                               | 6 s from the binary cache (lld fetched on first use) | 1–3 min cold: 1.8 GB more unpacked closure (rustc, cargo, llvm/lld, binaryen, wasm-bindgen-cli) on top of the default shell's 0.9 GB; about 0 with a warm nix store |
| cold cargo build (`CARGO_BUILD_JOBS=4`, fresh `CARGO_HOME`, crates downloaded) | 11.1 s                                               | 20–40 s                                                                                                                                                             |
| incremental (touch `lib.rs`), whole `build.sh`                                 | 1.4 s                                                | 3–5 s                                                                                                                                                               |
| no-op `build.sh`                                                               | 0.25 s                                               | —                                                                                                                                                                   |
| reproducibility                                                                | a clean rebuild gives byte-identical wasm            | the gate this would need                                                                                                                                            |

**What CI runs today: nothing.** The built module and glue are committed
under `src/pkg`, so Bun, the page build, `bun run verify` and CI never need
Rust. The cost of adopting is the gate that keeps those bytes honest: a job
that enters `.#wasm`, rebuilds, and fails on a diff. Only changes under the
crate or `flake.lock` would trigger it, and the toolchain download dominates
it.

**crane or naersk.** The experiment uses neither; a devShell plus committed
output was enough. If kb packages the crate as a nix derivation:

- **crane, which I recommend.** `buildDepsOnly` puts the dependency build in
  its own derivation, so a binary cache serves it and a crate edit rebuilds
  only the crate. It also takes a custom target (`wasm32-unknown-unknown`)
  and a custom toolchain cleanly.
- **naersk** is simpler, but builds dependencies and crate as one unit.
- **Caveats.** The sources the survey found could not verify either
  project's current maintenance. With one dependency (wasm-bindgen), the
  dependency layer is small either way.

**Against Bun's no-build loop.**

- Editing TypeScript stays no-build.
- Editing Rust means entering `.#wasm` and about 1.5 s per rebuild. That is
  tolerable on its own.
- **The real loop cost is the ABI.** The contract is a hand-kept numeric
  encoding, stated in `contract.ts`, mirrored in `lib.rs`, and wrapped by the
  loader: three places in two languages for one concept. The contract suite
  is the bridge that catches drift, but every change to the encoding is a
  three-file, two-language edit, plus a rebuild and a re-commit of the
  artifacts.

## 5. Plugins as WASM components: a second sandbox

This is a sketch, not a build. Today the sandbox is one port, `SandboxEngine`
(`packages/contract/sandbox/src/engine.ts`), with two engines:

| engine          | where it runs            | trust     | turn limit | heap limit |
| --------------- | ------------------------ | --------- | ---------- | ---------- |
| `quickjsEngine` | QuickJS compiled to wasm | untrusted | 500 ms     | 32 MB      |
| `workerEngine`  | a stripped Worker        | trusted   | 5 s        | none       |

Both run `sandboxContract`. Guest code sees one frozen `kb` object:

- `subject`, `invoke(action, input)`, `query(edn)`, `node(id, depth)`;
- `draw`, `on(type, handler)`, `h`, `log`.

What a guest may do is a `CodeGrant` (`reads`, `actions`), enforced by the
invoke core and again at the commit (DESIGN.md → Sandbox).

### Shape: a third engine, not a new plugin kind

A component engine is `SandboxEngine` with `kind: "component"`. It runs
`sandboxContract`, and only the guest's language changes. The WIT world is
the `kb` object, one-to-one:

```wit
package kb:guest@0.1.0;

interface host {
  /// The node the code runs on.
  subject: func() -> string;
  /// `node.get` within the grant's reads; JSON, as the JS prelude answers it.
  node: func(id: string, depth: u32) -> result<string, string>;
  /// `graph.query` within the grant's reads.
  query: func(edn: string) -> result<string, string>;
  /// A registry action, as `tools/call`; refused unless the grant names it.
  invoke: func(action: string, input-json: string) -> result<string, string>;
  /// A drawing (the `kb.h` tree, as JSON).
  draw: func(tree-json: string);
  log: func(level: u8, message: string);
}

interface guest {
  start: func() -> result<_, string>;
  on-event: func(kind: string, payload-json: string);
}

world script {
  import host;
  export guest;
}
```

### Capability security

The world imports `kb:guest/host` and nothing else: no WASI filesystem,
sockets, clocks or random.

- **Statically, the import list is the capability list.** A component that
  imports anything more fails to link, before it runs. QuickJS gets the same
  effect by deleting globals; a component never has them to begin with.
- **The grant stays dynamic, and stays host-side.** `answerToolCall` stamps
  each call with actor `script` and the code's grant. `scriptRefusal` and
  `grantRefusal` decide, and `scriptWriteRefusal` checks again at the
  commit. The WIT does not encode the grant. It bounds what any grant could
  ever reach. The known gap applies unchanged: "approved and the actor are
  declared, not proven" (`01M413SP3QSSQJMKKDK3W3J6G8`).
- **Limits.**
  - Turn time on the server is wasmtime fuel or epoch interruption.
  - In the page there is no fuel. The component therefore runs in a Worker
    with the existing 20 ms watchdog, as `workerEngine` does.
  - Heap is the module's declared memory maximum.

### The runtime is the hard part

kb's server is Bun, and Bun has no wasmtime. There are two ways to run a
component there:

| option   | what it means                                                                  | what it costs                                             |
| -------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| jco      | transpile the component to core wasm plus glue, and run it on Bun's own engine | no fuel, so a Worker per guest; jco on Bun is unproven    |
| wasmtime | load it as a native library through `bun:ffi`                                  | a native binary per platform, and a second build pipeline |

[Extism](https://extism.org/) is a third option. Its JS SDK is reported to
run on Bun and in browsers, but it is a plugin ABI of its own, not the
component model. **Prior art.**

- Zed runs extensions as WIT components on wasmtime, with a versioned API.
- Figma moved its plugin sandbox from Realms to QuickJS-in-wasm, which is
  kb's current choice.

### How it fits the plugin-codependency record

That record keeps one kernel, `@kb/plugin`, for owner code. It rejects
per-extension process isolation as "a different question, untrusted code,
which kb answers with trust and the sandbox".

A component is therefore a **guest**, like a code view or a script:

- It is not a kernel plugin.
- It neither `provide`s nor `inject`s keys, and it contributes to no point.
- Its only coupling to kb is the action ids it `invoke`s: hidden channel H1,
  "action calls by string id".

Two consequences follow:

1. **The grant's `actions` list is already the dependency list.**
   `extension.impact` (that record's §4.3) should read it, so switching off
   a family shows which guests' calls would start failing with `not_found`.
2. **Versioning.** The record versions contracts by renaming: "a breaking
   change to a key is a new key". A WIT package version is that rename. A
   breaking change to `kb:guest/host` is `@0.2.0`, which is a new world, and
   the host serves the worlds it still supports. No ranges, no resolver.

**When it pays.** When kb needs one of these:

- untrusted guests in a language other than JavaScript (Rust, Go, Python
  via componentize-py);
- guest code too heavy for QuickJS's 500 ms turn, that cannot be trusted
  into a Worker.

Neither exists yet. The cost is a runtime story on Bun, which must be
solved first.

## 6. Recommendation and open questions

**Recommendation: don't adopt Rust→WASM now.** In order:

1. **Review and merge Part A.**
   [#75](https://github.com/popemkt/kb/pull/75), [#76](https://github.com/popemkt/kb/pull/76)
   and [#77](https://github.com/popemkt/kb/pull/77) are algorithmic fixes.
   They are where most of the 50k slowness was.
2. **Close the named follow-ups in TypeScript**: the local integrity check,
   the CLI open, and the first `/api/graph`.
3. **The index: adopt the columnar representation, in TypeScript.** Front
   the conjunctive subset of datalog with a typed-array index that the
   DataScript path also reads. One index, two query paths over it, is a
   bridge. Two indexes kept in sync is a mirror, so the shape needs a design
   first.
4. **Revisit Rust→WASM for the join kernel only** if a profile after (3)
   still shows the join on a path a person waits on. The experiment's
   package and its contract suite are ready to resume: [#78](https://github.com/popemkt/kb/pull/78).
5. **Components as a sandbox engine:** only when a non-JavaScript untrusted
   guest is a real requirement, and after the Bun runtime question has an
   answer.

**Open questions.**

1. **How far does optimised TypeScript close the 2–2.5× on joins?** For
   example, numeric dedup keys instead of strings, and preallocated row
   buffers. The source-map precedent says most of the way. That measurement
   is cheap and decides step 4.
2. **Can a columnar index serve kb's whole datalog,** with rules, `not`/`or`
   and functions, by lowering through kb's own IR (`@kb/query` `ir/`)? Or
   does DataScript stay for the remainder? If DataScript stays, which one
   owns the index?
3. **Should the server build an index at all for CLI commands,** or should
   they reuse a running `kb ui`? About 5 s per command at 50k says reuse.
4. **For components:** jco on Bun, or wasmtime through `bun:ffi`? And is
   WASI 0.3 async, which the prior-art survey reports ratified in June 2026,
   needed for the host's async calls (`invoke` and `query` are async
   today)?

The experiment code is on [`exp/rust-wasm-datom-kernel`](https://github.com/popemkt/kb/tree/exp/rust-wasm-datom-kernel)
([#78](https://github.com/popemkt/kb/pull/78), a draft, not for merging):

- the contract and the TS kernel (`packages/domain/query/src/kernel/`);
- the crate and its loader (`packages/infrastructure/datom-kernel-wasm/`);
- the contract suite (`packages/app/test-kit/src/datom-kernel-contract.ts`);
- the benchmarks (`packages/infrastructure/datom-kernel-wasm/tests/kernel-bench*.ts`);
- the toolchain (`flake.nix` → `devShells.<system>.wasm`).
