/**
 * Where a stored query names a node by its text (AGENTS.md → Data-plane
 * freedom, "Everything references by id"): the literals it matches
 * `:node/text` against by equality. Read from the EDN itself, not the IR, so
 * a query outside the IR's subset is read too.
 */
import { readEdn, type Edn } from "@kb/query";

/** The predicates that compare by equality; contains, starts-with and ends-with are search. */
const EQUALITY = new Set(["=", "not="]);

/** `[?e :node/text x]`, or `[$src ?e :node/text x]`: the value position's term, else null. */
function textPatternValue(clause: Edn): Edn | null {
  if (clause.k !== "vec") return null;
  const at = clause.v.findIndex((item) => item.k === "kw" && item.v === ":node/text");
  if (at !== 1 && at !== 2) return null;
  if (at === 2 && clause.v[0]?.k !== "sym") return null;
  return clause.v.length === at + 2 ? (clause.v[at + 1] ?? null) : null;
}

/** `[(= a b)]` or `[(not= a b)]`: its arguments, else null. */
function equalityArgs(clause: Edn): readonly Edn[] | null {
  if (clause.k !== "vec") return null;
  const [call] = clause.v;
  if (call?.k !== "list") return null;
  const [fn, ...args] = call.v;
  return fn?.k === "sym" && EQUALITY.has(fn.v) ? args : null;
}

/** A datalog query: a vector that opens with `:find`, or a map holding `:find`. */
function isQuery(value: Edn): boolean {
  if (value.k === "vec") return value.v[0]?.k === "kw" && value.v[0].v === ":find";
  return value.k === "map" && value.v.some(([key]) => key.k === "kw" && key.v === ":find");
}

function children(value: Edn): readonly Edn[] {
  if (value.k === "vec" || value.k === "list") return value.v;
  if (value.k === "map") return value.v.flat();
  return [];
}

/**
 * The literals `edn` matches node text against by equality: `"todo"` in
 * `[?n :node/text "todo"]`, and in `[(= ?t "todo")]` (or `not=`) where a
 * pattern binds `?t` to `:node/text`. Empty when it names nodes some other
 * way, or is not one datalog query (prose that quotes a clause is not one). A variable is matched wherever the query
 * binds it, inside `or` and `not` too, so the answer errs towards finding.
 */
export function textMatchesOf(edn: string): readonly string[] {
  const value = readEdn(edn);
  if (value === null || !isQuery(value)) return [];
  const literals: string[] = [];
  const textVars = new Set<string>();
  const comparisons: (readonly Edn[])[] = [];
  const walk = (item: Edn): void => {
    const matched = textPatternValue(item);
    if (matched?.k === "str") literals.push(matched.v);
    else if (matched?.k === "sym" && matched.v.startsWith("?")) textVars.add(matched.v);
    const args = equalityArgs(item);
    if (args !== null) comparisons.push(args);
    for (const child of children(item)) walk(child);
  };
  walk(value);
  for (const args of comparisons) {
    if (!args.some((arg) => arg.k === "sym" && textVars.has(arg.v))) continue;
    for (const arg of args) if (arg.k === "str") literals.push(arg.v);
  }
  return literals;
}
