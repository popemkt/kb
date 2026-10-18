/**
 * A repository extension as a test writes one: its files under
 * `.kb/extensions/`, trusted on this machine the way a person's
 * `sandbox.trust` records it, by its closure's digest, since an untrusted
 * extension never runs (DESIGN.md → Core boundary & extensions →
 * repository extensions).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect, Layer } from "effect";
import { CodeTrust } from "@kb/contracts";
import { bunFileSystemLayer, closureOf } from "@kb/runtime";
import { codeTrustLayer } from "@kb/workspace-fs";

/** What {@link extensionModule} writes beside the module's own lines. */
export interface ExtensionModuleParts {
  /** Lines before the module's own: imports, helpers. */
  readonly prelude?: string;
  /** The declaration, as a JavaScript expression; by default the name alone. */
  readonly declaration?: string;
  /** The actions its server entry contributes, as a JavaScript array expression. */
  readonly actions?: string;
  /** The templates its server entry contributes, as a JavaScript array expression. */
  readonly templates?: string;
}

/**
 * A repository extension's module named `name`, as its author writes one
 * against `kb-ext-sdk`: its declaration, and its server entry contributing
 * `actions` and `templates` in `ext.<name>`.
 */
export function extensionModule(name: string, parts: ExtensionModuleParts = {}): string {
  const declaration = parts.declaration ?? JSON.stringify({ name, label: name });
  return `${parts.prelude ?? ""}
import {
  ActionPoint,
  Effect,
  TemplatePoint,
  defineExtension,
  definePlugin,
  extensionNamespace,
  provideAction,
  provideTemplate,
} from "kb-ext-sdk";
export const declaration = defineExtension(${declaration});
const actions = ${parts.actions ?? "[]"};
const templates = ${parts.templates ?? "[]"};
export default definePlugin({
  name: declaration.name,
  namespace: extensionNamespace(declaration.name),
  apply: (ctx) =>
    Effect.all(
      [
        Effect.forEach(actions, (action) => ctx.contribute(ActionPoint, provideAction(action)), {
          discard: true,
        }),
        Effect.forEach(templates, (template) => ctx.contribute(TemplatePoint, provideTemplate(template)), {
          discard: true,
        }),
      ],
      { discard: true },
    ),
});
`;
}

/** Write `.kb/extensions/<file>` under `root` with `source`, without trusting it; `file` may name a subdirectory. */
export const writeExtensionEffect = Effect.fn("test.writeExtension")(function* (
  root: string,
  file: string,
  source: string,
) {
  const path = join(root, ".kb", "extensions", file);
  yield* Effect.promise(() => mkdir(dirname(path), { recursive: true }));
  yield* Effect.promise(() => writeFile(path, source, "utf8"));
  return path;
});

/**
 * Trust the extension `file` (`<name>.ts`) of `root` on this machine, as
 * its files are now: its closure's digest. Dies when it cannot be closed
 * over, which a test that trusts it does not expect.
 */
export const trustExtensionEffect = Effect.fn("test.trustExtension")(function* (
  root: string,
  file: string,
) {
  const { digest } = yield* closureOf(root, file).pipe(
    Effect.provide(bunFileSystemLayer),
    Effect.mapError((why) => new Error(`${file} cannot be trusted: ${why}`)),
    Effect.orDie,
  );
  yield* Effect.gen(function* () {
    yield* (yield* CodeTrust).trust(digest);
  }).pipe(Effect.provide(codeTrustLayer(root).pipe(Layer.provide(bunFileSystemLayer))));
  return digest;
});

/** Write `.kb/extensions/<file>` under `root` and trust it, as its owner would. */
export const writeTrustedExtensionEffect = Effect.fn("test.writeTrustedExtension")(function* (
  root: string,
  file: string,
  source: string,
) {
  const path = yield* writeExtensionEffect(root, file, source);
  yield* trustExtensionEffect(root, file);
  return path;
});

export const writeExtension = (root: string, file: string, source: string): Promise<string> =>
  Effect.runPromise(writeExtensionEffect(root, file, source));
export const trustExtension = (root: string, file: string): Promise<string> =>
  Effect.runPromise(trustExtensionEffect(root, file));
export const writeTrustedExtension = (
  root: string,
  file: string,
  source: string,
): Promise<string> => Effect.runPromise(writeTrustedExtensionEffect(root, file, source));
