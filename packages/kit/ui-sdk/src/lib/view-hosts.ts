/**
 * Who names each view node, read from the whole graph (DESIGN.md → View
 * nodes): the reverse read a view node's title takes.
 */
import { viewHostsOf, type ViewHostOf } from "@kb/model";
import type { SchemaIndex } from "./schema";

const hostsBySchema = new WeakMap<SchemaIndex, ViewHostOf>();

/**
 * Who names each view node in `schema` (`viewHostsOf`), read once per
 * schema: a schema is one graph snapshot, so its reverse read is kept with
 * it. Every surface that names a node from the whole graph passes it to the
 * title, so a view node reads as what it is a view of.
 */
export function viewHostsIn(schema: SchemaIndex): ViewHostOf {
  const kept = hostsBySchema.get(schema);
  if (kept !== undefined) return kept;
  const hosts = viewHostsOf(schema.values());
  hostsBySchema.set(schema, hosts);
  return hosts;
}
