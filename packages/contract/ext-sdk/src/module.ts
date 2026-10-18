/**
 * What a repository extension's module exported, decoded once: the
 * declaration and the server entry a bundled family has (DESIGN.md → Core
 * boundary & extensions). A bundled family's two come from the build; a
 * repository extension's from trusted bytes in the root, so they are
 * checked as far as a runtime check can see. A declaration's data is
 * checkable, and checked; its functions (a seed, a view's text) and the
 * entry's `apply` are code whose signature no runtime check can observe,
 * so they are declared by the surface's types and held by the extension
 * contract, as a bundled family's are.
 */
import { Predicate, Result, Schema } from "effect";
import { declarationPlugin, type ExtensionDeclaration, type ExtensionEntry } from "@kb/contracts";
import { KbNodeSchema } from "@kb/model";
import type { Plugin } from "@kb/plugin";

/** A family's name: its `ext.<name>` namespace and its node's. */
const NAME_RE = /^[\w][\w.-]*$/;

/** One line, for a warning the loader prints per module: a `Schema` issue is an indented tree. */
function oneLine(message: string): string {
  return [...new Set(message.split("\n").map((line) => line.trim()))]
    .filter((line) => line.length > 0)
    .join(" ");
}

/** The data a declaration must carry; the rest of `ExtensionDeclaration` is read as written. */
const DeclarationData = Schema.Struct({
  name: Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((name: string) =>
        NAME_RE.test(name) ? undefined : "must match /^[\\w][\\w.-]*$/",
      ),
    ),
  ),
  label: Schema.String,
  optional: Schema.optional(Schema.Struct({ byDefault: Schema.Literals(["on", "off"]) })),
});

const decodeDeclarationData = Schema.decodeUnknownResult(DeclarationData);

/** What a seed returns, checked as a store checks what it loads: the fold writes it to the store. */
const decodeSeedNodes = Schema.decodeUnknownSync(Schema.Array(KbNodeSchema));

/** Why `value` is not a declaration, or null. */
function declarationIssue(value: unknown): string | null {
  const data = decodeDeclarationData(value);
  return Result.isFailure(data) ? oneLine(data.failure.message) : null;
}

function isDeclaration(value: unknown): value is ExtensionDeclaration {
  return declarationIssue(value) === null;
}

function isPlugin(value: unknown): value is Plugin {
  return (
    Predicate.hasProperty(value, "name") &&
    typeof value.name === "string" &&
    Predicate.hasProperty(value, "apply") &&
    Predicate.isFunction(value.apply)
  );
}

/**
 * Decode a repository extension's module, the one named `name` (its file's
 * name): its `declaration` export, whose name must be the file's, and its
 * default export, the server entry, a plugin. A module that exports no
 * entry is a family with no server-only package, so its entry is its
 * declaration's plugin, as a bundled family's is. Its seed is called by
 * the fold, and each node it returns is checked then, so a seed that
 * returns something other than nodes throws there, where its module is
 * refused.
 */
export function decodeExtensionModule(
  module: unknown,
  name: string,
): Result.Result<ExtensionEntry, string> {
  const declared = Predicate.hasProperty(module, "declaration") ? module.declaration : undefined;
  if (!isDeclaration(declared)) return Result.fail(`declaration: ${declarationIssue(declared)}`);
  if (declared.name !== name) {
    return Result.fail(`declaration: its name ${declared.name} must be its file's, ${name}`);
  }
  const { seed } = declared;
  const declaration: ExtensionDeclaration =
    seed === undefined ? declared : { ...declared, seed: (at) => decodeSeedNodes(seed(at)) };
  const entry = Predicate.hasProperty(module, "default") ? module.default : undefined;
  if (entry === undefined)
    return Result.succeed({ declaration, entry: declarationPlugin(declaration) });
  if (!isPlugin(entry)) {
    return Result.fail("default export must be its server entry: a plugin ({ name, apply })");
  }
  return Result.succeed({ declaration, entry });
}
