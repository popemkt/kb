/**
 * Which clauses speak about a conjunction's own variables. A plain `or`'s
 * branches share every variable with the scope around them (DataScript
 * requires all branches to use the same ones); an `or-join` shares only its
 * join vector, so its branches speak about the join variables and keep the
 * rest private; a `not` binds nothing outside itself, and what a `not-join`
 * says of its vector is what the vector is not. One home for that rule,
 * read by find typing (`parse.ts`), the columns `compile` gives a find, and
 * ref-valued revival (`datascript.ts`).
 */
import type { Clause, PredicateArg, Term } from "./ir.ts";

/**
 * `where`'s clauses and, recursively, those of every `or` branch in it. An
 * `or-join` branch comes back with each variable off the join vector renamed
 * to one no written query can name (an EDN symbol holds no space), private
 * to that branch: its facts about the join variables reach the scope, and a
 * branch-local variable never meets an outer one of the same name.
 */
export function outerClauses(where: readonly Clause[]): Clause[] {
  let branches = 0;
  const scoped = (clauses: readonly Clause[]): Clause[] =>
    clauses.flatMap((c) => {
      if (c.kind !== "or") return [c];
      if (c.join === undefined) return [c, ...c.branches.flatMap(scoped)];
      const shared = new Set(c.join);
      return [
        c,
        ...c.branches.flatMap((branch) => {
          branches += 1;
          const own = `${branches} `;
          return scoped(branch.map((b) => renamed(b, (v) => (shared.has(v) ? v : own + v))));
        }),
      ];
    });
  return scoped(where);
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

/** `c` with every variable, at any depth, renamed by `to`. */
function renamed(c: Clause, to: (name: string) => string): Clause {
  const term = <T extends Term | PredicateArg>(t: T): T =>
    t.t === "var" ? { ...t, name: to(t.name) } : t;
  switch (c.kind) {
    case "pattern":
      return { ...c, entity: to(c.entity), value: term(c.value) };
    case "children":
      return { ...c, parent: to(c.parent), child: to(c.child), order: to(c.order) };
    case "reach":
      return { ...c, from: to(c.from), to: to(c.to) };
    case "rule":
      return { ...c, args: c.args.map(term) };
    case "predicate":
      return {
        ...c,
        args: c.args.map(term),
        ...(c.bind === undefined ? {} : { bind: to(c.bind) }),
      };
    case "or":
      return {
        ...c,
        ...(c.join === undefined ? {} : { join: c.join.map(to) }),
        branches: c.branches.map((branch) => branch.map((b) => renamed(b, to))),
      };
    case "not":
      return {
        ...c,
        ...(c.join === undefined ? {} : { join: c.join.map(to) }),
        clauses: c.clauses.map((b) => renamed(b, to)),
      };
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}
