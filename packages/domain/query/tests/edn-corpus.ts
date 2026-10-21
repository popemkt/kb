/**
 * The EDN queries this repository holds, gathered deterministically from
 * files: every string prop value of the seed golden and of the repo's own
 * `.kb/nodes.jsonl`, every `.kb/queries/*.edn`, and every `[:find …]` string
 * literal in the workspace's TypeScript (suites and sources) that has no
 * interpolation. What parses to an `IrQuery` is the corpus the printer's
 * stability property runs over.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatalogError, parseEdn, type IrQuery } from "@kb/query";

const ROOT = join(import.meta.dir, "../../../..");

export type CorpusEntry = { readonly source: string; readonly edn: string };

function jsonlStrings(file: string): CorpusEntry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const node = JSON.parse(line) as {
        id: string;
        props?: Record<string, { t: string; v: unknown }[]>;
      };
      return Object.entries(node.props ?? {}).flatMap(([field, values]) =>
        values.flatMap((pv) =>
          pv.t === "str" && typeof pv.v === "string" && pv.v.trimStart().startsWith("[")
            ? [{ source: `${file}#${node.id}/${field}`, edn: pv.v }]
            : [],
        ),
      );
    });
}

function savedQueries(): CorpusEntry[] {
  const dir = join(ROOT, ".kb/queries");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".edn"))
    .map((f) => ({ source: join(dir, f), edn: readFileSync(join(dir, f), "utf8") }));
}

const DOUBLE = /"(\[:find(?:[^"\\\n]|\\.)*)"/g;
const SINGLE = /'(\[:find(?:[^'\\\n]|\\.)*)'/g;
const BACKTICK = /`(\[:find[^`$\\]*)`/g;

/** A quoted literal's body as the string it denotes. */
function unquote(body: string, quote: "'" | '"'): string {
  const asDouble = quote === '"' ? body : body.replaceAll("\\'", "'").replaceAll('"', '\\"');
  return JSON.parse(`"${asDouble}"`) as string;
}

/** The `.ts`/`.tsx` files under `dir`, relative to it; `node_modules` and symlinks are not entered. */
function sourceFiles(dir: string, prefix = ""): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(dir, rel);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

function sourceLiterals(): CorpusEntry[] {
  const packages = join(ROOT, "packages");
  const files = sourceFiles(packages);
  return files.toSorted().flatMap((f) => {
    const text = readFileSync(join(packages, f), "utf8");
    const at = (edn: string) => ({ source: `packages/${f}`, edn });
    return [
      ...[...text.matchAll(DOUBLE)].map((m) => at(unquote(m[1] ?? "", '"'))),
      ...[...text.matchAll(SINGLE)].map((m) => at(unquote(m[1] ?? "", "'"))),
      ...[...text.matchAll(BACKTICK)].map((m) => at(m[1] ?? "")),
    ];
  });
}

function parsed(entry: CorpusEntry): IrQuery | null {
  try {
    const ir = parseEdn(entry.edn);
    return ir.kind === "query" ? ir : null;
  } catch (err) {
    // A malformed `reach` in a suite that says so is not a query of the corpus.
    if (err instanceof DatalogError) return null;
    throw err;
  }
}

/** Every query of the corpus that parses to an `IrQuery`. */
export function ednCorpus(): Array<CorpusEntry & { readonly ir: IrQuery }> {
  return [
    ...jsonlStrings(join(ROOT, "packages/app/test-kit/src/seed.golden.jsonl")),
    ...jsonlStrings(join(ROOT, ".kb/nodes.jsonl")),
    ...savedQueries(),
    ...sourceLiterals(),
  ].flatMap((entry) => {
    const ir = parsed(entry);
    return ir === null ? [] : [{ ...entry, ir }];
  });
}
