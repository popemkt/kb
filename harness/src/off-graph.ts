/**
 * State kept outside the store, file by file (AGENTS.md → Rule 1, "State kept
 * outside the store is off-graph"). Where it counts is `OFF_GRAPH` in
 * `constraints.ts`. A use is read from the parsed module, so a name in a
 * string or a comment is not one; `Bun.write` is a use wherever it is
 * spelled. Each file with a use carries one marker that says why:
 *
 *   // off-graph: device-local — <why this belongs to the device>
 *   // off-graph: GAP [[<node-id>]]   (it belongs in the store; the gap names it)
 *   // off-graph: fine — <why it is not state worth keeping>
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isPackageTestFile, OFF_GRAPH } from "./constraints.ts";
import { isAstNode, parseModule, sourceFilesUnder, walkAst, type AstNode } from "./import-graph.ts";
import { PACKAGES_ROOT, workspacePackages } from "./workspace.ts";

/** A file's off-graph uses, and the marker lines it carries. */
export interface OffGraphFile {
  readonly uses: number;
  readonly markers: readonly string[];
}

const BROWSER_STORAGE: ReadonlySet<string> = new Set(OFF_GRAPH.browserStorage);
const FILE_WRITES: ReadonlySet<string> = new Set(OFF_GRAPH.fileWrites);
const FILE_WRITE_LAYERS: ReadonlySet<string> = new Set(OFF_GRAPH.fileWriteLayers);
const MARKER = /\/\/ off-graph:(.*)$/gm;
const MARKER_FORMS = [/^ device-local — \S/, /^ fine — \S/, /^ GAP \[\[[^\]\s]+\]\]/];

function nameOf(node: unknown): string | undefined {
  return isAstNode(node) && node.type === "Identifier" && typeof node["name"] === "string"
    ? node["name"]
    : undefined;
}

function isBunWrite(node: AstNode): boolean {
  return (
    node.type === "MemberExpression" &&
    nameOf(node["object"]) === "Bun" &&
    nameOf(node["property"]) === "write"
  );
}

/** How many off-graph uses `source` holds, for a file in `layer`. */
function offGraphUses(file: string, source: string, layer: string): number {
  const writes = FILE_WRITE_LAYERS.has(layer);
  let uses = 0;
  walkAst(parseModule(file, source).program, (node) => {
    const name = nameOf(node);
    if (name !== undefined && BROWSER_STORAGE.has(name)) uses += 1;
    else if (writes && name !== undefined && FILE_WRITES.has(name)) uses += 1;
    else if (writes && isBunWrite(node)) uses += 1;
  });
  return uses;
}

/** Every production file with an off-graph use or a marker, keyed relative to `packages/`. */
export function collectOffGraph(packagesRoot: string = PACKAGES_ROOT): Map<string, OffGraphFile> {
  const files = new Map<string, OffGraphFile>();
  for (const pkg of workspacePackages(packagesRoot)) {
    const root = join(packagesRoot, pkg.dir);
    for (const path of sourceFilesUnder(root)) {
      const rel = relative(root, path);
      if (!rel.startsWith("src/") || isPackageTestFile(rel)) continue;
      const source = readFileSync(path, "utf8");
      const uses = offGraphUses(path, source, pkg.layer);
      const markers = [...source.matchAll(MARKER)].map((match) => match[1] ?? "");
      if (uses > 0 || markers.length > 0)
        files.set(relative(packagesRoot, path), { uses, markers });
    }
  }
  return files;
}

/** The ratchet lane: each file's use count. */
export function offGraphCounts(files: ReadonlyMap<string, OffGraphFile>): Record<string, number> {
  return Object.fromEntries(
    [...files]
      .filter(([, file]) => file.uses > 0)
      .map(([path, file]) => [path, file.uses] as const)
      .toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

/** Every file whose marker is missing, doubled, malformed, or left where no use is. */
export function markerProblems(files: ReadonlyMap<string, OffGraphFile>): string[] {
  const problems: string[] = [];
  for (const [path, { uses, markers }] of files) {
    if (uses === 0) {
      problems.push(`off-graph ${path} carries a marker but keeps nothing off-graph; remove it`);
      continue;
    }
    if (markers.length !== 1) {
      problems.push(
        `off-graph ${path} keeps state outside the store and carries ${markers.length} markers; it needs one: ` +
          "// off-graph: device-local — <why> | GAP [[<node-id>]] | fine — <why>",
      );
      continue;
    }
    const [marker = ""] = markers;
    if (!MARKER_FORMS.some((form) => form.test(marker)))
      problems.push(`off-graph ${path} marker does not say why:${marker}`);
  }
  return problems.toSorted();
}
