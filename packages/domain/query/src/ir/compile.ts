import { present } from "@kb/model";
import type {
  Clause,
  FindPos,
  Ir,
  IrQuery,
  PredicateArg,
  PullSpec,
  ReachClause,
  Term,
} from "./ir.ts";
import { boundVars } from "./scope.ts";

const QUERY_DIRECTIVES = new Set([
  "find",
  "where",
  "in",
  "with",
  "keys",
  "limit",
  "offset",
  "rules",
]);

/**
 * DataScript JS API stores attrs as strings; EDN queries use keywords.
 * Rewrite `:attr` → `":attr"` (quoted) except query directives.
 *
 * One home: the compiler. `query()` and `runIr` both go through this.
 */
export function normalizeEdnQuery(edn: string): string {
  const keyword = /^:([A-Za-z*][\w./+*-]*)/;
  let out = "";
  let i = 0;
  while (i < edn.length) {
    if (edn[i] === '"') {
      let j = i + 1;
      while (j < edn.length) {
        if (edn[j] === "\\") j += 2;
        else if (edn[j] === '"') {
          j += 1;
          break;
        } else j += 1;
      }
      out += edn.slice(i, j);
      i = j;
      continue;
    }
    const m = keyword.exec(edn.slice(i));
    if (m) {
      const directive = present(m[1], "edn keyword");
      out += QUERY_DIRECTIVES.has(directive) ? m[0] : `"${m[0]}"`;
      i += m[0].length;
      continue;
    }
    out += edn[i];
    i += 1;
  }
  return out;
}

type CompiledEdn = {
  query: string;
  rules?: string;
  /** The find positions the compiled query returns, column by column; absent for `raw`. */
  find?: readonly FindPos[];
};

/**
 * Compile IR to DataScript EDN. `raw` passes through (still normalised).
 * `reach` becomes a recursive `%` rule, wherever it sits (inside `or` and
 * `not` too); `children` projects `:node/children`.
 */
export function compile(ir: Ir): CompiledEdn {
  if (ir.kind === "raw") return { query: normalizeEdnQuery(ir.edn) };
  const reaches = everyClause(ir.where).filter((c): c is ReachClause => c.kind === "reach");
  const names = new Map<ReachClause, string>();
  for (const [i, r] of reaches.entries()) {
    names.set(r, `__kb_reach_${i}`);
  }
  const rules = reaches.length > 0 ? compileReachRules(reaches, names) : undefined;
  const inSlots = compileIn(ir.in, rules !== undefined);
  const columns = compiledFind(ir);
  const find = columns.map(compileFind).join(" ");
  const where = ir.where.map((c) => compileClause(c, names)).join(" ");
  const edn = `[:find ${find}${inSlots} :where ${where}]`;
  return {
    query: normalizeEdnQuery(edn),
    ...(rules !== undefined ? { rules: normalizeEdnQuery(rules) } : {}),
    find: columns,
  };
}

/** Every clause of `where`, at any depth, in written order. */
function everyClause(where: readonly Clause[]): Clause[] {
  return where.flatMap((c) => {
    if (c.kind === "or") return [c, ...c.branches.flatMap(everyClause)];
    if (c.kind === "not") return [c, ...everyClause(c.clauses)];
    return [c];
  });
}

/**
 * The find positions that get a column: every one but a `children` clause's
 * order variable, which the projection does not bind (`ChildrenClause`),
 * unless something else binds it. Any other variable is the engine's to
 * accept or reject, as it would be in raw EDN.
 */
function compiledFind(ir: IrQuery): FindPos[] {
  const bound = boundVars(ir.where);
  for (const slot of ir.in ?? []) bound.add(slot);
  const orders = new Set(
    ir.where.flatMap((c) => (c.kind === "children" && !bound.has(c.order) ? [c.order] : [])),
  );
  return ir.find.filter((p) => p.kind !== "var" || !orders.has(p.name));
}

function compileIn(slots: string[] | undefined, needsRules: boolean): string {
  const rest = [...(slots ?? [])];
  if (needsRules && !rest.includes("%")) rest.unshift("%");
  if (rest.length === 0) return "";
  const parts = rest.map((s) => (s === "%" ? "%" : `?${s}`));
  return ` :in $ ${parts.join(" ")}`;
}

function compileFind(pos: FindPos): string {
  if (pos.kind === "var") return `?${pos.name}`;
  if (pos.kind === "aggregate") return `(${pos.op} ?${pos.of})`;
  return `(pull ?${pos.of} ${compilePull(pos.pattern)})`;
}

function compilePull(pattern: PullSpec): string {
  const parts = pattern.map((el) => {
    if (typeof el === "string") return el;
    const inner = Object.entries(el)
      .map(([attr, nested]) => `${attr} ${compilePull(nested)}`)
      .join(" ");
    return `{${inner}}`;
  });
  return `[${parts.join(" ")}]`;
}

function compileClause(clause: Clause, names: ReadonlyMap<ReachClause, string>): string {
  switch (clause.kind) {
    case "pattern":
      return `[?${clause.entity} ${clause.attr} ${compileTerm(clause.value)}]`;
    case "children": {
      const cs = `?__kb_cs_${clause.parent}`;
      return `[?${clause.parent} :node/children ${cs}] [(identity ${cs}) [?${clause.child} ...]]`;
    }
    case "reach": {
      const name = present(names.get(clause), "reach rule name");
      if (clause.maxHops !== undefined) return `(${name} ?${clause.from} ?${clause.to} 1)`;
      return `(${name} ?${clause.from} ?${clause.to})`;
    }
    case "rule":
      return `(${[clause.name, ...clause.args.map(compileTerm)].join(" ")})`;
    case "predicate": {
      const call = `(${[clause.fn, ...clause.args.map(compileArg)].join(" ")})`;
      return clause.bind === undefined ? `[${call}]` : `[${call} ?${clause.bind}]`;
    }
    case "or": {
      const branches = clause.branches.map((branch) => {
        const forms = branch.map((c) => compileClause(c, names));
        // `children` compiles to two forms, so a one-clause branch may still need `and`.
        return forms.length === 1 && branch[0]?.kind !== "children"
          ? forms.join(" ")
          : `(and ${forms.join(" ")})`;
      });
      return `(${[joinHead("or", clause.join), ...branches].join(" ")})`;
    }
    case "not": {
      const body = clause.clauses.map((c) => compileClause(c, names));
      return `(${[joinHead("not", clause.join), ...body].join(" ")})`;
    }
    default: {
      const _exhaustive: never = clause;
      return _exhaustive;
    }
  }
}

/** `or` / `not`, or their `-join` form with its vector. */
function joinHead(op: "or" | "not", join: readonly string[] | undefined): string {
  return join === undefined ? op : `${op}-join [${join.map((v) => `?${v}`).join(" ")}]`;
}

function compileArg(arg: PredicateArg): string {
  if (arg.t === "src") return "$";
  if (arg.t === "attr") return arg.value;
  return compileTerm(arg);
}

function compileTerm(term: Term): string {
  if (term.t === "var") return `?${term.name}`;
  if (term.t === "str") return JSON.stringify(term.value);
  if (term.t === "bool") return term.value ? "true" : "false";
  if (term.t === "blank") return "_";
  return String(term.value);
}

function compileReachRules(
  reaches: ReachClause[],
  names: ReadonlyMap<ReachClause, string>,
): string {
  const chunks = reaches.map((r) => compileOneReach(r, present(names.get(r), "reach rule name")));
  return `[${chunks.join(" ")}]`;
}

/**
 * Every hop's far end must be a node, so a step and a result are nodes. The
 * test is `[?v :node/id ?v_id]`, which drops bools and numbers that are not
 * eids. DataScript throws when a string is bound into that entity slot, and a
 * dangling field ref is its id string. So strings go first, by the one value
 * whose `str` is itself. A number that equals a live eid still passes; the
 * encoding, not this test, is what cannot tell it from a ref
 * (GAP [[01M3A0Y5JQ5XKZMC87K34HDT2B]]).
 */
function isNode(v: string): string {
  return `[(str ?${v}) ?${v}_str] [(not= ?${v}_str ?${v})] [?${v} :node/id ?${v}_id]`;
}

function compileOneReach(clause: ReachClause, name: string): string {
  const edge = clause.edge;
  const max = clause.maxHops;
  if (max === undefined) {
    return `[(${name} ?a ?b) [?a ${edge} ?b] ${isNode("b")}] [(${name} ?a ?b) [?a ${edge} ?mid] ${isNode("mid")} (${name} ?mid ?b)]`;
  }
  return `[(${name} ?a ?b ?h) [?a ${edge} ?b] ${isNode("b")} [(<= ?h ${max})]] [(${name} ?a ?b ?h) [?a ${edge} ?mid] ${isNode("mid")} [(< ?h ${max})] [(+ ?h 1) ?h2] (${name} ?mid ?b ?h2)]`;
}
