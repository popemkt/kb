/**
 * The IR as stored EDN: the inverse of `parseEdn` on the canonical domain
 * (`isCanonicalIr`). For storage and for showing a person the query, never
 * for running it; `compile` is what runs.
 */
import { writeEdn, type Edn } from "./edn.ts";
import type { Clause, FindPos, IrQuery, PredicateArg, PullSpec, Term } from "./ir.ts";

const sym = (v: string): Edn => ({ k: "sym", v });
const kw = (v: string): Edn => ({ k: "kw", v });
const variable = (name: string): Edn => sym(`?${name}`);

/**
 * `ir` as canonical EDN: the head (`:find`, `:in`, `:where`) on the first
 * line, then each `:where` clause on a line of its own, indented one space,
 * in IR order; one space between forms within a line. A raw query has no IR
 * and is never printed: its text is kept as written.
 */
export function printEdn(ir: IrQuery): string {
  const head: Edn[] = [kw(":find"), ...ir.find.map(findEdn)];
  if (ir.in !== undefined) head.push(kw(":in"), sym("$"), ...ir.in.map(inEdn));
  head.push(kw(":where"));
  const lines = ir.where.map((clause) => clauseEdn(clause).map(writeEdn).join(" "));
  return `[${head.map(writeEdn).join(" ")}\n ${lines.join("\n ")}]`;
}

function inEdn(slot: string): Edn {
  return slot === "%" ? sym("%") : variable(slot);
}

function findEdn(pos: FindPos): Edn {
  if (pos.kind === "var") return variable(pos.name);
  if (pos.kind === "aggregate") return { k: "list", v: [sym(pos.op), variable(pos.of)] };
  return { k: "list", v: [sym("pull"), variable(pos.of), pullEdn(pos.pattern)] };
}

function pullEdn(pattern: PullSpec): Edn {
  return {
    k: "vec",
    v: pattern.map((el) =>
      typeof el === "string"
        ? kw(el)
        : { k: "map", v: Object.entries(el).map(([attr, nested]) => [kw(attr), pullEdn(nested)]) },
    ),
  };
}

function termEdn(term: Term): Edn {
  switch (term.t) {
    case "var":
      return variable(term.name);
    case "str":
      return { k: "str", v: term.value };
    case "num":
      return { k: "num", v: term.value };
    case "bool":
      return { k: "bool", v: term.value };
    case "blank":
      return sym("_");
    default: {
      const _exhaustive: never = term;
      return _exhaustive;
    }
  }
}

/** `or` / `not`, or the `-join` form and its vector. */
function joinHead(op: "or" | "not", join: readonly string[] | undefined): Edn[] {
  if (join === undefined) return [sym(op)];
  return [sym(`${op}-join`), { k: "vec", v: join.map(variable) }];
}

/** An `or` branch: bare when it writes as one form, `(and …)` when it writes as several. */
function branchEdn(branch: readonly Clause[]): Edn {
  const forms = branch.flatMap(clauseEdn);
  const [only] = forms;
  return forms.length === 1 && only !== undefined ? only : { k: "list", v: [sym("and"), ...forms] };
}

function argEdn(arg: PredicateArg): Edn {
  if (arg.t === "src") return sym("$");
  if (arg.t === "attr") return kw(arg.value);
  return termEdn(arg);
}

/** One clause's written forms: one, or the two patterns `children` is written as. */
function clauseEdn(clause: Clause): Edn[] {
  switch (clause.kind) {
    case "pattern":
      return [{ k: "vec", v: [variable(clause.entity), kw(clause.attr), termEdn(clause.value)] }];
    case "children":
      return [
        { k: "vec", v: [variable(clause.parent), kw(":node/child"), variable(clause.child)] },
        { k: "vec", v: [variable(clause.parent), kw(":node/child-order"), variable(clause.order)] },
      ];
    case "reach": {
      const max: Edn[] = clause.maxHops === undefined ? [] : [{ k: "num", v: clause.maxHops }];
      const parts = [sym("reach"), variable(clause.from), kw(clause.edge), variable(clause.to)];
      return [{ k: "list", v: [...parts, ...max] }];
    }
    case "rule":
      return [{ k: "list", v: [sym(clause.name), ...clause.args.map(termEdn)] }];
    case "predicate": {
      const call: Edn = { k: "list", v: [sym(clause.fn), ...clause.args.map(argEdn)] };
      return [{ k: "vec", v: clause.bind === undefined ? [call] : [call, variable(clause.bind)] }];
    }
    case "or":
      return [
        { k: "list", v: [...joinHead("or", clause.join), ...clause.branches.map(branchEdn)] },
      ];
    case "not":
      return [
        {
          k: "list",
          v: [...joinHead("not", clause.join), ...clause.clauses.flatMap(clauseEdn)],
        },
      ];
    default: {
      const _exhaustive: never = clause;
      return _exhaustive;
    }
  }
}
