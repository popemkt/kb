import { basename, extname } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { forEachChild, parse, type SyntaxNode, type Word, type WordPart } from "unbash";
import { z } from "zod";
import { propText, type CheckModel, type Finding } from "./model.ts";
import { isFile, pathInRoot } from "./repo-files.ts";

const scripts = z.object({ scripts: z.record(z.string(), z.string()) });
const workflow = z.object({
  jobs: z.record(
    z.string(),
    z.object({ steps: z.array(z.object({ run: z.string().optional() })).optional() }),
  ),
});
const rules = z.object({ rules: z.record(z.string(), z.unknown()).optional() });
const lintConfig = rules.extend({ overrides: z.array(rules).optional() });

function isLiteralPart(part: WordPart): boolean {
  if (part.type === "DoubleQuoted") {
    return part.parts.every((child) => child.type === "Literal");
  }
  return part.type === "Literal" || part.type === "SingleQuoted" || part.type === "AnsiCQuoted";
}

/** Fully literal words compare after quote removal. Dynamic words retain their shell syntax. */
function wordKey(word: Word): string {
  const literal = word.parts?.every(isLiteralPart) ?? true;
  return literal ? `literal:${word.value}` : `syntax:${word.text}`;
}

/** Read statically spelled command words without running the shell or expanding variables. */
function shellCommands(source: string): string[][] {
  const commands: string[][] = [];
  function visit(node: SyntaxNode): void {
    if (node.type === "Script" && (node.errors?.length ?? 0) > 0) return;
    if (node.type === "Command" && node.name !== undefined) {
      const args = node.args.map((arg) =>
        arg.type === "Word" ? wordKey(arg) : `assignment:${source.slice(arg.pos, arg.end)}`,
      );
      commands.push([wordKey(node.name), ...args]);
    }
    forEachChild(node, visit);
  }
  visit(parse(source));
  return commands;
}

function commandMatches(source: string, invocation: readonly string[]): boolean {
  return shellCommands(source).some((words) =>
    invocation.every((word, index) => word === words[index]),
  );
}

function enabledRule(config: z.infer<typeof rules>, invocation: string): boolean {
  const setting = config.rules?.[invocation];
  const severity: unknown = Array.isArray(setting) ? setting[0] : setting;
  return severity === "warn" || severity === "error" || severity === 1 || severity === 2;
}

function shellSources(path: string, source: string): string[] {
  if (basename(path) === "package.json") {
    const parsed = scripts.safeParse(JSON.parse(source));
    return parsed.success ? Object.values(parsed.data.scripts) : [];
  }
  if ([".yml", ".yaml"].includes(extname(path))) {
    const parsed = workflow.safeParse(Bun.YAML.parse(source));
    return parsed.success
      ? Object.values(parsed.data.jobs).flatMap(({ steps }) =>
          (steps ?? []).flatMap(({ run }) => (run === undefined ? [] : [run])),
        )
      : [];
  }
  return extname(path) === "" || extname(path) === ".sh" ? [source] : [];
}

/** Surface files are declared in the store. Their format determines what can wire a check. */
function matchesInvocation(path: string, source: string, invocation: string): boolean {
  try {
    if (basename(path) === ".oxlintrc.json") {
      const parsed = lintConfig.safeParse(Bun.JSONC.parse(source));
      return (
        parsed.success &&
        [parsed.data, ...(parsed.data.overrides ?? [])].some((config) =>
          enabledRule(config, invocation),
        )
      );
    }
    const [words, ...rest] = shellCommands(invocation);
    return (
      words !== undefined &&
      rest.length === 0 &&
      shellSources(path, source).some((body) => commandMatches(body, words))
    );
  } catch {
    return false;
  }
}

const surfaceFiles = Effect.fn("ext.check.surfaceFiles")(function* (
  root: string,
  patterns: readonly string[],
) {
  const fs = yield* FileSystem;
  const files = new Set<string>();
  for (const pattern of patterns) {
    const wildcard = pattern.indexOf("*");
    if (wildcard < 0) {
      const path = pathInRoot(root, pattern);
      if (path !== undefined && (yield* isFile(path))) files.add(path);
      continue;
    }

    const separator = pattern.lastIndexOf("/", wildcard);
    const directory = pathInRoot(root, separator < 0 ? "." : pattern.slice(0, separator));
    const filenamePattern = pattern.slice(separator + 1);
    const [prefix, suffix, extra] = filenamePattern.split("*");
    if (
      directory === undefined ||
      prefix === undefined ||
      suffix === undefined ||
      extra !== undefined
    ) {
      continue;
    }
    const entries = yield* fs
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): string[] => []));
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
      const path = pathInRoot(
        root,
        `${separator < 0 ? "" : pattern.slice(0, separator + 1)}${entry}`,
      );
      if (path !== undefined && (yield* isFile(path))) files.add(path);
    }
  }
  return [...files].toSorted();
});

const invocationIsWired = Effect.fn("ext.check.invocationIsWired")(function* (
  root: string,
  model: CheckModel,
  surface: string | undefined,
  invocation: string | undefined,
) {
  const patterns = surface === undefined ? undefined : model.surfaceFiles.get(surface);
  if (patterns === undefined || invocation === undefined || invocation === "") return false;
  const fs = yield* FileSystem;
  const files = yield* surfaceFiles(root, patterns);
  for (const path of files) {
    const content = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
    if (matchesInvocation(path, content, invocation)) return true;
  }
  return false;
});

export const findInvocationUnwired = Effect.fn("ext.check.findInvocationUnwired")(function* (
  root: string,
  model: CheckModel,
) {
  const invocationUnwired: Finding[] = [];
  for (const check of model.checks) {
    const surface = propText(model, check, "surface");
    const invocation = propText(model, check, "invocation");
    if (!(yield* invocationIsWired(root, model, surface, invocation))) {
      invocationUnwired.push({
        kind: "invocation-unwired",
        check: check.id,
        message: `check ${check.id} invocation is not wired on ${surface ?? "(missing)"}: ${invocation ?? "(missing)"}`,
      });
    }
  }
  return invocationUnwired;
});
