/**
 * The IR as stored EDN: the inverse of `parseEdn` on the canonical domain
 * (`isCanonicalIr`). For storage and for showing a person the query, never
 * for running it; `compile` is what runs.
 */
import { writeEdn, type Edn } from "./edn.ts";
import type { Clause, FindPos, IrQuery, PullSpec, Term } from "./ir.ts";

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
    default: {
      const _exhaustive: never = term;
      return _exhaustive;
    }
  }
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
    default: {
      const _exhaustive: never = clause;
      return _exhaustive;
    }
  }
}
