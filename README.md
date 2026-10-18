# kb

Repo-native outliner datastore, built as a Bun workspace: every concept is a
package under `packages/<layer>/<name>`. Bun is the production runtime; the toolchain
is TypeScript 7 + Vite+ (`vp` 0.2.8) + oxlint + Nx. See
[DESIGN.md](./DESIGN.md) for the workspace shape, the runtime/tooling
boundary, and the Effect action-handler seam.

```bash
bun install         # one lockfile for the whole workspace
bun run verify      # the entry point; its steps are its definition in package.json
bun run typecheck   # nx run-many -t typecheck (authoritative, also pre-commit)
bun run lint        # oxlint --type-aware over packages/
bun run test        # bun test packages
bun run test:ui     # Vitest inside @kb/ui
bun run test:dst    # deterministic simulation sweep
bun run harness     # repo-shape checks (boundaries, public surface, versions)
```

Two runners, split by package rather than by file: everything except `@kb/ui`
runs on `bun test`; the browser package runs on Vitest because its suite needs
happy-dom, `vi.mock` hoisting and fake timers. `bunfig.toml` states that split
once.

Core / bundled actions are Effect-native (`ActionDefinition.effect` +
`KbCtx`/`KbStore`/`FileSystem` Layers). Third-party `.kb/extensions` may keep
Promise `handler`s; the registry uses `tryPromise` only for those.

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
