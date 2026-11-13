/** Module-design sensors; policy and ceilings live in constraints.ts. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_NAME_LAYERS, isPackageTestFile } from "./constraints.ts";
import { declaredNames } from "./families.ts";
import {
  parseModule,
  sourceFilesUnder,
  stringLiteral,
  walkAst,
  isAstNode,
} from "./import-graph.ts";
import { PACKAGES_ROOT, workspacePackages } from "./workspace.ts";

/** Unique public names, including type-only exports; aliases count by their public name.
 * GAP [[01M787EFNSYXKT510HYDPGVB9A]]: A namespace is one exported name. Namespace-member width remains deferred; the consumer graph treats namespaces conservatively.
 */
export function exportedNames(file: string, source: string): string[] {
  const names = new Set<string>();
  for (const statement of parseModule(file, source).module.staticExports) {
    for (const entry of statement.entries) {
      if (entry.exportName.name === null) {
        throw new Error(`${file}: unnamed star export cannot be measured as a curated surface`);
      }
      names.add(entry.exportName.name);
    }
  }
  return [...names].toSorted();
}

function span(node: Record<string, unknown>): string {
  return `${String(node["start"])}:${String(node["end"])}`;
}

/**
 * The DOM's key vocabulary: `KeyboardEvent.code` names a key by its place,
 * and kb's chords and key events carry it under that standard name. The
 * key `code` of an object literal typed as one of these (annotated,
 * `satisfies`, `as`, or the body of an arrow declaring it) is that word,
 * not the code family; every other key and every value still counts.
 */
const DOM_KEY_TYPES: ReadonlySet<string> = new Set(["Chord", "KeyChordEvent"]);
const DOM_KEY = "code";

/** Whether `annotation` (a type, or its annotation wrapper) names a DOM key type. */
function typedAsDomKey(annotation: unknown): boolean {
  const type =
    isAstNode(annotation) && annotation.type === "TSTypeAnnotation"
      ? annotation["typeAnnotation"]
      : annotation;
  if (!isAstNode(type) || type.type !== "TSTypeReference") return false;
  const name = type["typeName"];
  return isAstNode(name) && typeof name["name"] === "string" && DOM_KEY_TYPES.has(name["name"]);
}

/**
 * The DOM key `node` types, if it types an object literal as a DOM key
 * type: a declarator's annotation, `satisfies` or `as`, or an arrow's
 * declared return over its expression body.
 */
function typedDomKey(node: Record<string, unknown>): unknown {
  const id = node["id"];
  if (node.type === "VariableDeclarator" && isAstNode(id)) {
    return typedAsDomKey(id["typeAnnotation"]) ? domKeyOf(node["init"]) : undefined;
  }
  if (node.type === "TSSatisfiesExpression" || node.type === "TSAsExpression") {
    return typedAsDomKey(node["typeAnnotation"]) ? domKeyOf(node["expression"]) : undefined;
  }
  if (node.type === "ArrowFunctionExpression") {
    return typedAsDomKey(node["returnType"]) ? domKeyOf(node["body"]) : undefined;
  }
  return undefined;
}

/** The `code` key of `value`, an object literal (parenthesized or not), if it has one. */
function domKeyOf(value: unknown): unknown {
  let object = value;
  while (isAstNode(object) && object.type === "ParenthesizedExpression")
    object = object["expression"];
  if (!isAstNode(object) || object.type !== "ObjectExpression") return undefined;
  const properties = object["properties"];
  if (!Array.isArray(properties)) return undefined;
  for (const property of properties) {
    if (!isAstNode(property) || property.type !== "Property" || property["computed"] === true) {
      continue;
    }
    const key = property["key"];
    if (isAstNode(key) && (key["name"] ?? stringLiteral(key)) === DOM_KEY) return key;
  }
  return undefined;
}

/** Family ids and identifiers in semantic positions, once per source occurrence. */
export function familyNameHits(file: string, source: string, families: readonly string[]): number {
  const program = parseModule(file, source).program;
  const propertySpans = new Set<string>();
  const exclude = (node: unknown): void => {
    if (isAstNode(node)) propertySpans.add(span(node));
  };
  const excludeTypeKeys = (node: unknown): void => {
    walkAst(node, (child) => {
      if (child.type === "TSLiteralType") exclude(child["literal"]);
    });
  };
  walkAst(program, (node) => {
    if (node.type === "MemberExpression" && node["computed"] !== true) exclude(node["property"]);
    exclude(typedDomKey(node));
    if (
      typeof node.type === "string" &&
      [
        "TSPropertySignature",
        "PropertyDefinition",
        "MethodDefinition",
        "TSMethodSignature",
      ].includes(node.type)
    ) {
      const key = node["key"];
      if (node["computed"] !== true || stringLiteral(key) !== undefined) exclude(key);
    }
    if (node.type === "TSIndexedAccessType") excludeTypeKeys(node["indexType"]);
    if (node.type !== "TSTypeReference") return;
    const name = node["typeName"];
    const args = node["typeArguments"];
    if (!isAstNode(name) || !isAstNode(args) || !Array.isArray(args["params"])) return;
    const [input, keys] = args["params"];
    if (
      name["name"] === "Pick" ||
      name["name"] === "Omit" ||
      (name["name"] === "Exclude" &&
        isAstNode(input) &&
        input.type === "TSTypeOperator" &&
        input["operator"] === "keyof")
    ) {
      excludeTypeKeys(keys);
    }
  });
  const spans = new Set<string>();
  walkAst(program, (node) => {
    if (propertySpans.has(span(node))) return;
    const name = node.type === "Identifier" ? node["name"] : stringLiteral(node);
    if (typeof name !== "string") return;
    if (!families.some((family) => name === family || name.startsWith(`${family}.`))) return;
    spans.add(span(node));
  });
  return spans.size;
}

export interface ModuleMeasures {
  surface: Record<string, number>;
  "family-names": Record<string, number>;
}

/** Declarations are the authority, as in extension-families; never infer ids from folders. */
export function collectModuleMeasures(packagesRoot: string = PACKAGES_ROOT): ModuleMeasures {
  const packages = workspacePackages(packagesRoot);
  const families = new Set<string>();
  for (const pkg of packages.filter((candidate) => candidate.layer === "extension")) {
    for (const file of sourceFilesUnder(join(packagesRoot, pkg.dir, "src"))) {
      if (isPackageTestFile(file)) continue;
      for (const name of declaredNames(file, readFileSync(file, "utf8"))) {
        if (name !== undefined) families.add(name);
      }
    }
  }
  const surface: Record<string, number> = {};
  const names: Record<string, number> = {};
  for (const pkg of packages) {
    if (JSON.stringify(pkg.manifest.exports) !== "{}") {
      const barrel = join(packagesRoot, pkg.dir, "src/index.ts");
      const width = exportedNames(barrel, readFileSync(barrel, "utf8")).length;
      if (width > 0) surface[pkg.name] = width;
    }
    if (!CORE_NAME_LAYERS.includes(pkg.layer)) continue;
    for (const file of sourceFilesUnder(join(packagesRoot, pkg.dir, "src"))) {
      const count = familyNameHits(file, readFileSync(file, "utf8"), [...families]);
      if (count > 0)
        names[`${pkg.dir}/${file.slice(join(packagesRoot, pkg.dir).length + 1)}`] = count;
    }
  }
  return { surface, "family-names": names };
}
