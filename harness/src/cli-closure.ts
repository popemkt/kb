/** Source and emitted static closures, independent of emitted chunk names. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative } from "node:path";
import { LAZY_FENCES } from "./constraints.ts";
import { lazyFenceViolations } from "./import-closure.ts";
import type { ImportClosureSite } from "./import-closure.ts";
import { importsOf } from "./import-graph.ts";
import { WORKSPACE_ROOT } from "./workspace.ts";

/** Follow workspace source imports; external modules remain terminal edges. */
function sourceClosureSites(entry: string): ImportClosureSite[] {
  const sites: ImportClosureSite[] = [];
  const queue = [entry];
  const seen = new Set<string>();
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const path = join(WORKSPACE_ROOT, file);
    for (const record of importsOf(path, readFileSync(path, "utf8"))) {
      let target: string | undefined;
      if (!record.specifier.startsWith("node:") && !record.specifier.startsWith("bun:")) {
        const resolved = Bun.resolveSync(record.specifier, dirname(path));
        const rel = relative(WORKSPACE_ROOT, resolved);
        if (rel.startsWith("packages/") && /\.[cm]?[jt]sx?$/.test(rel)) target = rel;
      }
      sites.push({ file, specifier: record.specifier, kind: record.kind, target });
      if (record.kind !== "type" && target !== undefined) queue.push(target);
    }
  }
  return sites;
}

export interface MetafileOutput {
  bytes: number;
  entryPoint?: string;
  inputs: Record<string, unknown>;
  imports: Array<{ path: string; kind: string; external?: boolean }>;
}

/** Sum every eagerly imported output once, including shared chunks, excluding dynamic imports. */
export function staticOutputClosure(
  outputs: Record<string, MetafileOutput>,
  entry: string,
): Record<string, number> {
  outputs = Object.fromEntries(
    Object.entries(outputs).map(([key, value]) => [normalize(key), value]),
  );
  const start = Object.keys(outputs).find((key) => outputs[key]?.entryPoint === entry);
  if (start === undefined) throw new Error(`metafile has no entry ${entry}`);
  const seen = new Set<string>();
  const inputs = new Set<string>();
  const queue = [start];
  let bytes = 0;
  for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
    if (seen.has(key)) continue;
    seen.add(key);
    const output = outputs[key];
    if (output === undefined) throw new Error(`metafile is missing static output ${key}`);
    bytes += output.bytes;
    for (const input of Object.keys(output.inputs)) inputs.add(input);
    for (const imported of output.imports) {
      if (imported.external === true || imported.kind === "dynamic-import") continue;
      queue.push(join(dirname(key), imported.path));
    }
  }
  return { bytes, modules: inputs.size };
}

/** Build only for measurement; the release layout is untouched. */
export function collectStaticClosure(entry: string): Record<string, number> {
  const scratch = mkdtempSync(join(tmpdir(), "kb-closure-"));
  try {
    const metafile = join(scratch, "meta.json");
    execFileSync(
      "bun",
      [
        "build",
        entry,
        "--target=bun",
        "--splitting",
        "--minify-whitespace",
        `--metafile=${metafile}`,
        `--outdir=${scratch}/out`,
      ],
      {
        cwd: WORKSPACE_ROOT,
        stdio: "pipe",
      },
    );
    const meta = JSON.parse(readFileSync(metafile, "utf8")) as {
      outputs: Record<string, MetafileOutput>;
    };
    return staticOutputClosure(meta.outputs, entry);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Stable breach identities omit witness paths, so rerouting does not churn the ledger. */
export function collectCliFence(): Record<string, number> {
  const fence = LAZY_FENCES.cli;
  const findings: Record<string, number> = {};
  for (const { site } of lazyFenceViolations(sourceClosureSites(fence.entry), fence)) {
    const identity = `${site.file} imports ${site.specifier}`;
    findings[identity] = (findings[identity] ?? 0) + 1;
  }
  return findings;
}
