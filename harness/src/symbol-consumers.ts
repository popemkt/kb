/** Production module imports joined to the declarations their public names expose. */
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { isPackageTestFile, SINGLE_FAMILY_LAYERS } from "./constraints.ts";
import { importsOf, parseModule, sourceFilesUnder } from "./import-graph.ts";
import { PACKAGES_ROOT, packageAxes, workspacePackages } from "./workspace.ts";

type Parsed = ReturnType<typeof parseModule>;
interface Module {
  path: string;
  owner: string;
  parsed: Parsed;
  source: string;
}
export interface ConsumedSymbol {
  /** Declaring source file, relative to packages/. */
  file: string;
  name: string;
  owner: string;
  /** Production importing files, relative to packages/. */
  importers: Set<string>;
}

/** Types count as consumers too. Namespace/dynamic imports conservatively consume all names.
 * No identifier-use analysis, call graph or served SDK membership is needed by this lane.
 */
export function symbolConsumers(packagesRoot: string = PACKAGES_ROOT): ConsumedSymbol[] {
  const packages = workspacePackages(packagesRoot);
  const modules = new Map<string, Module>();
  const barrels = new Map<string, string>();
  for (const pkg of packages) {
    if (JSON.stringify(pkg.manifest.exports) !== "{}")
      barrels.set(pkg.name, join(packagesRoot, pkg.dir, "src/index.ts"));
    const root = join(packagesRoot, pkg.dir);
    for (const path of sourceFilesUnder(root)) {
      const rel = relative(root, path);
      if (!rel.startsWith("src/") || isPackageTestFile(rel)) continue;
      const source = readFileSync(path, "utf8");
      modules.set(path, { path, owner: pkg.name, parsed: parseModule(path, source), source });
    }
  }
  const resolve = (from: string, specifier: string): string | undefined => {
    const barrel = barrels.get(specifier);
    if (barrel !== undefined) return barrel;
    if (!specifier.startsWith(".")) return undefined;
    const path = Bun.resolveSync(specifier, dirname(from));
    return modules.has(path) ? path : undefined;
  };
  const symbols = new Map<string, ConsumedSymbol>();
  const own = (module: Module, name: string): ConsumedSymbol => {
    const key = `${module.path}:${name}`;
    let symbol = symbols.get(key);
    if (symbol === undefined) {
      symbol = {
        file: relative(packagesRoot, module.path),
        name,
        owner: module.owner,
        importers: new Set(),
      };
      symbols.set(key, symbol);
    }
    return symbol;
  };
  const exports = new Map<string, Map<string, ConsumedSymbol[]>>();
  const exposed = (path: string): Map<string, ConsumedSymbol[]> => {
    const cached = exports.get(path);
    if (cached !== undefined) return cached;
    const out = new Map<string, ConsumedSymbol[]>();
    exports.set(path, out); // Forwarding cycles terminate without inventing a consumer.
    const module = modules.get(path);
    if (module === undefined) return out;
    for (const statement of module.parsed.module.staticExports) {
      for (const entry of statement.entries) {
        const name = entry.exportName.name;
        const specifier = entry.moduleRequest?.value;
        const target = specifier === undefined ? undefined : resolve(path, specifier);
        if (target === undefined) {
          if (name !== null) {
            const local = entry.localName.name ?? name;
            const imported = module.parsed.module.staticImports
              .flatMap((site) => site.entries.map((binding) => ({ site, binding })))
              .find(({ binding }) => binding.localName.value === local);
            const origin =
              imported === undefined ? undefined : resolve(path, imported.site.moduleRequest.value);
            if (origin !== undefined && imported !== undefined) {
              const names = exposed(origin);
              out.set(
                name,
                imported.binding.importName.name === null
                  ? [...names.values()].flat()
                  : (names.get(imported.binding.importName.name) ?? []),
              );
            } else out.set(name, [own(module, local)]);
          }
          continue;
        }
        const forwarded = exposed(target);
        if (entry.importName.name !== null) {
          if (name !== null) out.set(name, forwarded.get(entry.importName.name) ?? []);
        } else if (name !== null) {
          out.set(name, [...forwarded.values()].flat());
        } else {
          for (const [key, value] of forwarded) out.set(key, value);
        }
      }
    }
    return out;
  };
  for (const path of modules.keys()) exposed(path);
  for (const module of modules.values()) {
    const consume = (specifier: string, names?: readonly string[]): void => {
      const target = resolve(module.path, specifier);
      if (target === undefined) return;
      const publicNames = exposed(target);
      const selected =
        names === undefined
          ? [...publicNames.values()].flat()
          : names.flatMap((name) => publicNames.get(name) ?? []);
      for (const symbol of selected) symbol.importers.add(relative(packagesRoot, module.path));
    };
    const staticOffsets = new Set<number>();
    for (const imported of module.parsed.module.staticImports) {
      staticOffsets.add(imported.moduleRequest.start);
      const names = imported.entries.map((entry) => entry.importName.name);
      consume(
        imported.moduleRequest.value,
        names.some((name) => name === null) ? undefined : names.filter((name) => name !== null),
      );
    }
    const exportOffsets = new Set(
      module.parsed.module.staticExports.flatMap((statement) =>
        statement.entries.flatMap((entry) =>
          entry.moduleRequest === null ? [] : [entry.moduleRequest.start],
        ),
      ),
    );
    for (const record of importsOf(module.path, module.source)) {
      if (!staticOffsets.has(record.start) && !exportOffsets.has(record.start))
        consume(record.specifier);
    }
  }
  return [...symbols.values()];
}

/** Every core file whose known consumers belong to exactly one extension family. */
export function collectSingleFamily(packagesRoot: string = PACKAGES_ROOT): Record<string, number> {
  const packages = workspacePackages(packagesRoot);
  const axes = packageAxes(packages);
  const ownerOf = (file: string) => packages.find((pkg) => file.startsWith(`${pkg.dir}/`))?.name;
  const files = new Map<string, { owner: string; importers: Set<string> }>();
  for (const symbol of symbolConsumers(packagesRoot)) {
    const entry = files.get(symbol.file) ?? { owner: symbol.owner, importers: new Set<string>() };
    for (const importer of symbol.importers) entry.importers.add(importer);
    files.set(symbol.file, entry);
  }
  const findings: Record<string, number> = {};
  for (const [file, { owner, importers }] of files) {
    if (!SINGLE_FAMILY_LAYERS.includes(axes.get(owner)?.layer ?? "")) continue;
    if (importers.size === 0) continue;
    const families = new Set(
      [...importers].map((importer) => axes.get(ownerOf(importer) ?? "")?.family),
    );
    if (families.size === 1 && !families.has(undefined)) findings[file] = 1;
  }
  return findings;
}
