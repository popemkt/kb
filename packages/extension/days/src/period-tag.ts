/**
 * Which tag a new period gets (DESIGN.md → Days): the family's `day tag`
 * or `week tag` setting when it names a tag that is the base or extends it
 * (`sys.f.extends`, read through its chain), else the base. A person makes
 * `#my day` extend `#day`, points `day tag` at it, and every new day carries
 * their fields, while `#day`'s view and key come with it through the chain.
 * A commit that points a setting at a tag that does not extend the base is
 * refused with why; a tag that later stops extending it, or is deleted,
 * reads as the base, as a journal setting naming a deleted node reads empty.
 */
import { Effect } from "effect";
import type { ActionGuard } from "@kb/contracts";
import { refValuesOf, tagChains, type NodeLookup, type NodeLike, type NodeWrite } from "@kb/model";
import { DAYS_IDS } from "./ids.ts";

/** Each period tag setting and the base tag its value must reach. */
export const PERIOD_TAG_SETTINGS = [
  { field: DAYS_IDS.dayTagField, base: DAYS_IDS.dayTag, name: "day" },
  { field: DAYS_IDS.weekTagField, base: DAYS_IDS.weekTag, name: "week" },
] as const;

/** Whether `tag` is a node that is `base` or extends it. */
function reaches(tag: string, base: string, nodeOf: NodeLookup): boolean {
  return nodeOf(tag) !== undefined && tagChains(nodeOf).ancestors(tag).includes(base);
}

/** The tag a new period of `base` gets, by the family node's `field` setting. */
export function periodTagOf(
  family: Pick<NodeLike, "props"> | undefined,
  field: string,
  base: string,
  nodeOf: NodeLookup,
): string {
  const [chosen] = refValuesOf(family, field);
  return chosen !== undefined && reaches(chosen, base, nodeOf) ? chosen : base;
}

/**
 * Why `writes` may not land: a period tag setting they change now names a
 * tag that does not reach its base, read over the graph as it would be
 * after the commit (`nodeOf`); null when every setting they touch is fine.
 */
export function periodTagRefusal(
  writes: readonly NodeWrite[],
  nodeOf: (id: string) => NodeLike | undefined,
): string | null {
  const family = writes.find(({ after }) => after?.id === DAYS_IDS.family);
  if (family?.after === undefined) return null;
  for (const { field, base, name } of PERIOD_TAG_SETTINGS) {
    const [chosen] = refValuesOf(family.after, field);
    if (chosen === undefined || chosen === refValuesOf(family.before, field)[0]) continue;
    if (!reaches(chosen, base, nodeOf)) {
      const label = nodeOf(chosen)?.text ?? chosen;
      return `${label} does not extend #${name}: a ${name}'s tag is #${name} or a tag that extends it`;
    }
  }
  return null;
}

export const periodTagGuard: Omit<ActionGuard, "match"> = {
  commit: (call) =>
    Effect.sync(() => {
      const written = new Map(
        call.writes.map(({ before, after }) => [(after ?? before)?.id, after]),
      );
      const nodeOf = (id: string): NodeLike | undefined =>
        written.has(id) ? written.get(id) : call.nodeOf(id);
      const refusal = periodTagRefusal(call.writes, nodeOf);
      return refusal === null
        ? { decision: "allow" as const }
        : { decision: "deny" as const, rule: "days.period-tag", message: refusal };
    }),
};
