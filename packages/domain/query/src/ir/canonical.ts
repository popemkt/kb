/**
 * The IR's canonical domain: the `IrQuery` values `parseEdn` can produce.
 * A value outside it is a well-typed IR no EDN text reads as (a find typed
 * otherwise than its `:where` types it, a `children` clause beside the
 * patterns it collapses from, a number the reader cannot read back), so no
 * printer could round-trip it. The round-trip properties range over this
 * domain, and their generator produces only values in it.
 */
import { isKeywordText, isReadableNumber, isSymbolText } from "./edn.ts";
import type { Clause, FindPos, IrQuery, PullSpec, Term } from "./ir.ts";
import { inferFindTypes } from "./parse.ts";

/** Whether `ir` is a value `parseEdn` produces (above). */
export function isCanonicalIr(ir: IrQuery): boolean {
  return (
    ir.find.length > 0 &&
    ir.find.every(isCanonicalFindPos) &&
    sameFind(ir.find, inferFindTypes(ir.find, ir.where)) &&
    (ir.in === undefined || (ir.in.length > 0 && ir.in.every(isInSlot))) &&
    ir.where.length > 0 &&
    isCanonicalConjunction(ir.where)
  );
}

/** `?name` reads back as the variable `name`. */
function isVarName(name: string): boolean {
  return isSymbolText(`?${name}`);
}

function isInSlot(slot: string): boolean {
  return slot === "%" || isVarName(slot);
}

function isCanonicalFindPos(pos: FindPos): boolean {
  if (pos.kind === "pull") return isVarName(pos.of) && isCanonicalPull(pos.pattern);
  if (pos.kind === "aggregate") return isVarName(pos.of);
  return isVarName(pos.name);
}

function isCanonicalPull(pattern: PullSpec): boolean {
  return pattern.every((el) =>
    typeof el === "string"
      ? isKeywordText(el)
      : Object.entries(el).every(
          ([attr, nested]) => isKeywordText(attr) && isCanonicalPull(nested),
        ),
  );
}

function sameFind(a: readonly FindPos[], b: readonly FindPos[]): boolean {
  return a.every((pos, i) => pos.type === b[i]?.type);
}

function isCanonicalTerm(term: Term): boolean {
  if (term.t === "var") return isVarName(term.name);
  if (term.t === "num") return isReadableNumber(term.value);
  return true;
}

/** A rule name the reader reads as a symbol, and not a variable. */
function isRuleName(name: string): boolean {
  return isSymbolText(name) && !name.startsWith("?");
}

function isCanonicalClause(clause: Clause): boolean {
  switch (clause.kind) {
    case "pattern":
      return (
        isVarName(clause.entity) && isKeywordText(clause.attr) && isCanonicalTerm(clause.value)
      );
    case "children":
      return isVarName(clause.parent) && isVarName(clause.child) && isVarName(clause.order);
    case "reach":
      return (
        isVarName(clause.from) &&
        isVarName(clause.to) &&
        isKeywordText(clause.edge) &&
        (clause.maxHops === undefined ||
          (Number.isSafeInteger(clause.maxHops) && clause.maxHops >= 1))
      );
    case "rule":
      return isRuleName(clause.name) && clause.args.every(isCanonicalTerm);
    default: {
      const _exhaustive: never = clause;
      return _exhaustive;
    }
  }
}

/**
 * One conjunction's clauses. The written form of `children` is two patterns
 * the parser collapses, so a conjunction holding `children` for a parent
 * holds no `:node/child` or `:node/child-order` pattern of that parent over a
 * variable, and at most one `children` per parent; and no entity has both a
 * `:node/child` and a `:node/child-order` pattern over a variable, which
 * would have collapsed.
 */
function isCanonicalConjunction(clauses: readonly Clause[]): boolean {
  if (!clauses.every(isCanonicalClause)) return false;
  const parents = clauses.flatMap((c) => (c.kind === "children" ? [c.parent] : []));
  if (new Set(parents).size !== parents.length) return false;
  const over = (attr: string) =>
    new Set(
      clauses.flatMap((c) =>
        c.kind === "pattern" && c.value.t === "var" && c.attr === attr ? [c.entity] : [],
      ),
    );
  const child = over(":node/child");
  const order = over(":node/child-order");
  return (
    parents.every((p) => !child.has(p) && !order.has(p)) && [...child].every((e) => !order.has(e))
  );
}
