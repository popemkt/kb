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
