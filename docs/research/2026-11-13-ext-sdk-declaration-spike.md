# ext-sdk declaration generation: spike

Research note, 2026-11-13. Scope: step M9 of the module migration, which
generates the `kb-ext-sdk` and `kb-ext-sdk/page` ambient declarations from
re-export lists instead of the hand-kept `surface.ts` and `page-surface.ts`
(principle P6, "one type, one source"). The acceptance test is that the
`ext-sdk-fresh` author fixture compiles and the emitted text does not
change. The deferral is gap `01M79MBMJQKDBBGJ2HG8Z6QEG2`. This note is the
reasoning behind it and is not kept in step with the code.

## Result

The switch is not a move. It needs two contract decisions and a tooling step first, so M9
stops at the spike and nothing in `@kb/ext-sdk` changes.

## 1. The originals are not the same declarations

Of the 101 exports in `surface.ts`, there are three kinds:

- **Exact copies.** `PluginContext` in `@kb/plugin` matches the SDK's member
  for member; only `Effect.Effect` is spelled `effect.Effect.Effect`. A
  declaration bundler would produce these with formatting changes only.
- **Schema-derived types.** `ActionMode` (`@kb/contracts`) and `FailureCode`
  (`@kb/model`) are `z.infer<typeof …Schema>`. Their declarations name
  zod's types, so a bundled ambient module would need zod, which an
  extension's repository does not have. The emitted text changes from a
  plain union to zod generics.
- **Narrowed projections.** The SDK's `KbContext` is `{ root, nodes }`, but
  `@kb/contracts`' `KbContext<Index>` carries the index and the session's
  services. Re-exporting the original would widen what authors may rely on,
  which is a change to the public contract rather than a move.

Generating only the exact copies would give one module two mechanisms, a
generated part and a hand-kept part, which Rule 1 rules out.

## 2. The toolchain

Vite+ 0.2.8 ships tsdown with `rolldown-plugin-dts`. The spike entry was
`export type { … } from "@kb/contracts" | "@kb/model" | "@kb/plugin"`,
with `@kb/*` always bundled and `effect`, `react` and `zod` external.

- **oxc mode** (isolated declarations) fails at the first exported
  `Effect.fn(...)` without an explicit annotation
  (`plugin/src/role-call.ts`, TS9010). The workspace has hundreds of them.
- **tsgo mode** (`typescript@7.0.2`, which warns that it is experimental)
  emits nothing for workspace packages reached through `node_modules`
  symlinks. A generated `paths` map over every `packages/*/*/src/index.ts`
  gets past that, then stops at `@kb/query`, where `datascript.ts` and a
  hand-written `datascript.d.ts` sit side by side (TS5055: the emit would
  overwrite an input).

## 3. What would close it

1. Type-first originals for the schema-derived types: the type is written
   out, and the schema `satisfies z.ZodType<T>`.
2. Author-facing types that `@kb/contracts` owns by name, for each
   narrowed projection, so the re-export list names them.
3. `@kb/query`'s datascript pair under one name, and either annotations
   for isolated declarations or the tsgo mode with a generated `paths` map.
4. Then the switch itself: `surface.ts` and `page-surface.ts` become
   `export type { … } from` lists beside `EXTENSION_SDK` and
   `PAGE_EXTENSION_SDK`, and `scripts/generate.ts` bundles them.

Points 1 and 2 add contracts, so they need an owner decision before work
starts.
