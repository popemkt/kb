/**
 * Core's migration `core.field-show` (DESIGN.md → Data model → field
 * display): a field's hidden checkbox, `sys.f.hidden`, became its show
 * option. Every field a person hid with it is shown *never*, the checkbox
 * leaves every node and template that held it, and its field node goes.
 * A field that already says its show keeps it; a `false` said nothing, and
 * is dropped. Pure and idempotent: a store without the checkbox plans
 * nothing.
 */
import type { ExtensionMigration, MigrationGraph } from "@kb/contracts";
import { SYSTEM_IDS, type KbNode, type PropValue } from "@kb/model";

/** The retired checkbox, which the seed no longer holds. */
export const RETIRED_HIDDEN_FIELD = "sys.f.hidden";

const NEVER: PropValue = { t: "ref", v: SYSTEM_IDS.showNever };

/** Whether `values` say the field is hidden: the checkbox's stored `true`. */
const saysHidden = (values: readonly PropValue[] | undefined): boolean =>
  values?.some((value) => value.t === "bool" && value.v) ?? false;

/** `values` without any reference to the retired checkbox, or the same list where none. */
function withoutRetired(values: readonly PropValue[]): PropValue[] | null {
  const kept = values.filter((value) => !(value.t === "ref" && value.v === RETIRED_HIDDEN_FIELD));
  return kept.length === values.length ? null : kept;
}

/** `node` moved off the checkbox, or null when it holds nothing of it. */
function migrated(node: KbNode, at: string): KbNode | null {
  const props: Record<string, PropValue[]> = { ...node.props };
  let changed = false;
  const hidden = props[RETIRED_HIDDEN_FIELD];
  if (hidden !== undefined) {
    delete props[RETIRED_HIDDEN_FIELD];
    if (saysHidden(hidden) && props[SYSTEM_IDS.showField] === undefined)
      props[SYSTEM_IDS.showField] = [NEVER];
    changed = true;
  }
  for (const [field, values] of Object.entries(props)) {
    const kept = withoutRetired(values);
    if (kept === null) continue;
    changed = true;
    if (kept.length === 0) delete props[field];
    else props[field] = kept;
  }
  const children = node.children.filter((id) => id !== RETIRED_HIDDEN_FIELD);
  if (children.length !== node.children.length) changed = true;
  return changed ? { ...node, props, children, updatedAt: at } : null;
}

export const fieldShowMigration: ExtensionMigration = {
  id: "field-show",
  title: "Hidden fields become show: never",
  description:
    "A field's hidden checkbox became its show option: each field it hid is shown never, and the checkbox leaves every node and template that held it.",
  run: (graph: MigrationGraph) => ({
    upserts: graph.nodes.flatMap((node) => {
      if (node.id === RETIRED_HIDDEN_FIELD) return [];
      const next = migrated(node, graph.at);
      return next === null ? [] : [next];
    }),
    deletes: graph.nodeOf(RETIRED_HIDDEN_FIELD) === undefined ? [] : [RETIRED_HIDDEN_FIELD],
  }),
  check: (graph: MigrationGraph) =>
    graph.nodes
      .filter(
        (node) =>
          node.id === RETIRED_HIDDEN_FIELD ||
          RETIRED_HIDDEN_FIELD in node.props ||
          Object.values(node.props).some((values) => withoutRetired(values) !== null),
      )
      .map((node) => `${node.id} still holds ${RETIRED_HIDDEN_FIELD}`),
};
