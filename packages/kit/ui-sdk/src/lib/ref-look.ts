/**
 * How references into a schema read in text (`RefLook`): the ink the tag
 * colours give them (`refInkIn`) and the name `refName` gives them
 * (DESIGN.md → Display text). One look per schema, so a memo keyed on it
 * survives until the graph changes.
 */
import { refName } from "@kb/model";
import type { RefLook } from "./md-edit";
import type { SchemaIndex } from "./schema";
import { refInkIn } from "./tag-color";

const looks = new WeakMap<SchemaIndex, RefLook>();

/** The look of references into `schema`. */
export function refLookOf(schema: SchemaIndex): RefLook {
  const cached = looks.get(schema);
  if (cached !== undefined) return cached;
  const nodeOf = (id: string) => schema.get(id);
  const look: RefLook = {
    ink: (id) => refInkIn(schema, id),
    name: (id, label) => refName(id, label, nodeOf),
  };
  looks.set(schema, look);
  return look;
}
