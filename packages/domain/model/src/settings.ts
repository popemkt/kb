/**
 * An extension's settings, read (DESIGN.md → Extension families → An
 * extension's configuration is fields on its node). The field nodes are the
 * schema: a setting of a node is a system field whose `sys.f.configures`
 * names it ({@link configures}), so which settings a node has is a reading
 * of the graph, never a registry beside it. This is that one reading, and
 * every surface that lists settings reads it: `extension.settings` (and so
 * `kb ext settings`, MCP and the agent) on the server, the Settings page and
 * the Extensions page in the browser.
 *
 * The switch (`sys.f.extension.enabled`) is a setting of every extension's
 * node too, but it is left out: it is a load decision with its own checked
 * verb (`extension.switch`) and its own report (`extension.list`), so a
 * reader of settings never offers it as a field to write.
 */
import { cardinalityOf, declaresOptionSet, fieldTypeOf } from "./field-type.ts";
import type { Cardinality, FieldType } from "./field-type.ts";
import { SYSTEM_IDS, type NodeId } from "./model.ts";
import { typeRefsOf, type NodeLike } from "./ontology.ts";
import { configures } from "./system-write.ts";

/** One option of a setting whose values are its field's children. */
export interface SettingOption {
  readonly id: NodeId;
  readonly label: string;
}

/** One setting of a node: its field, as the field's node declares it. */
export interface Setting {
  readonly field: NodeId;
  /** The field node's text. */
  readonly label: string;
  readonly type: FieldType;
  readonly cardinality: Cardinality;
  /** The field's option set, in child order; empty for a field that declares none. */
  readonly options: readonly SettingOption[];
}

/**
 * The settings of `nodeId`: every field among `nodes` that configures it,
 * the switch excluded, in id order (the same on every host and backend,
 * whatever order a store lists its nodes in). `nodeOf` resolves an option's
 * label.
 */
export function settingsOf(
  nodes: Iterable<NodeLike>,
  nodeOf: (id: NodeId) => Pick<NodeLike, "text"> | undefined,
  nodeId: NodeId,
): Setting[] {
  const settings: Setting[] = [];
  for (const field of nodes) {
    if (field.id === SYSTEM_IDS.extensionEnabledField) continue;
    if (!typeRefsOf(field).includes(SYSTEM_IDS.field)) continue;
    if (!configures(field.id, field, { id: nodeId })) continue;
    settings.push({
      field: field.id,
      label: field.text,
      type: fieldTypeOf(field.props),
      cardinality: cardinalityOf(field.props),
      options: declaresOptionSet(field)
        ? field.children.map((id) => ({ id, label: nodeOf(id)?.text ?? id }))
        : [],
    });
  }
  return settings.toSorted((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
}
