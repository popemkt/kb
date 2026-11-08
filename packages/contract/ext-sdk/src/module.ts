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
import { KbNodeSchema, knobSchemaError } from "@kb/model";
import { isPlugin } from "@kb/plugin";

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
  declaredOptions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Struct({ field: Schema.String, prefix: Schema.String }),
        options: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            label: Schema.String,
            knobs: Schema.optional(
              Schema.Array(
                Schema.Struct({
                  kind: Schema.Literals(["number", "boolean", "enum", "color", "seed"]),
                  id: Schema.String,
                  label: Schema.String,
                }),
              ),
            ),
          }),
        ),
      }),
    ),
  ),
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

/**
 * Why a repository extension may not declare its options, or null: each is
 * named in its own namespace (`<name>.<local id>`), so it can answer to no
 * other family's option, and each knob schema is one the panel can draw and
 * the fold derive fields for (`knobSchemaError`).
 */
function declaredOptionsIssue(declaration: ExtensionDeclaration): string | null {
  for (const { options } of declaration.declaredOptions ?? []) {
    for (const option of options) {
      if (!option.id.startsWith(`${declaration.name}.`)) {
        return `declaration: its option ${option.id} must be named ${declaration.name}.<id>, in its own namespace`;
      }
      const knobs = knobSchemaError(option.knobs ?? []);
      if (knobs !== null) return `declaration: its option ${option.id}: ${knobs}`;
    }
  }
  return null;
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
  const options = declaredOptionsIssue(declared);
  if (options !== null) return Result.fail(options);
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
