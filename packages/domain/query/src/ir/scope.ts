/**
 * Which clauses speak about a conjunction's own variables. A plain `or`'s
 * branches share every variable with the scope around them (DataScript
 * requires all branches to use the same ones); an `or-join` shares only its
 * join vector; a `not` binds nothing outside itself. One home for that rule,
 * read by find typing (`parse.ts`), the columns `compile` gives a find, and
 * ref-valued revival (`datascript.ts`).
 */
import type { Clause } from "./ir.ts";

/** `where`'s clauses and, recursively, those of every plain `or` branch in it. */
export function outerClauses(where: readonly Clause[]): Clause[] {
  return where.flatMap((c) =>
    c.kind === "or" && c.join === undefined
      ? [c, ...c.branches.flatMap((branch) => outerClauses(branch))]
      : [c],
  );
}

/** The variables `where` binds in its own scope; one bound only inside a `not`, or an `or-join` branch off its join, is not. */
export function boundVars(where: readonly Clause[]): Set<string> {
  const bound = new Set<string>();
  for (const c of outerClauses(where)) {
    for (const name of bindsOf(c)) bound.add(name);
  }
  return bound;
}

function bindsOf(c: Clause): readonly string[] {
  switch (c.kind) {
    case "pattern":
      return c.value.t === "var" ? [c.entity, c.value.name] : [c.entity];
    case "children":
      return [c.parent, c.child];
    case "reach":
      return [c.from, c.to];
    case "rule":
      return c.args.flatMap((a) => (a.t === "var" ? [a.name] : []));
    case "predicate":
      return c.bind === undefined ? [] : [c.bind];
    case "or":
      return c.join ?? [];
    case "not":
      return [];
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}
