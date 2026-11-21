import { type SchemaIndex, WORKSPACE_ROOT_ID } from "@kb/ui-sdk";
import { rowBreadcrumbs } from "./backlinks";
import type { Crumb } from "./crumbs";

/**
 * References written in one place: the rows that are children of one node
 * (DESIGN-UI.md → References). The place is where a reader would go to see
 * them in context, so a page's References read as that page's outline does,
 * place by place, and the path above a place is drawn once, not once per row.
 */
export interface ReferenceGroup<Row> {
  /** The node the rows are children of; null for rows at the top level. */
  readonly place: string | null;
  /** The path above the place, outermost first (home omitted). */
  readonly crumbs: readonly Crumb[];
  /** The rows, in the order the place holds them. */
  readonly rows: readonly Row[];
}

/** The latest edit among `ids`, as the ISO stamp compares. */
function latestEdit(schema: SchemaIndex, ids: readonly string[]): string {
  let latest = "";
  for (const id of ids) {
    const at = schema.get(id)?.updatedAt ?? "";
    if (at > latest) latest = at;
  }
  return latest;
}

/**
 * `rows` grouped by their place, the place most recently written in first,
 * each group's rows in the place's own order. Ties keep the order the rows
 * came in.
 */
export function groupByPlace<Row>(
  rows: readonly Row[],
  idOf: (row: Row) => string,
  schema: SchemaIndex,
): ReferenceGroup<Row>[] {
  const byPlace = new Map<string | null, Row[]>();
  for (const row of rows) {
    const parent = schema.get(idOf(row))?.parentId ?? null;
    const place = parent === WORKSPACE_ROOT_ID ? null : parent;
    const group = byPlace.get(place) ?? [];
    group.push(row);
    byPlace.set(place, group);
  }

  const groups = [...byPlace].map(([place, members]) => {
    const order = place === null ? [] : (schema.get(place)?.children ?? []);
    const at = (row: Row) => {
      const index = order.indexOf(idOf(row));
      return index === -1 ? order.length : index;
    };
    return {
      group: {
        place,
        crumbs: place === null ? [] : rowBreadcrumbs(schema, place),
        rows: members.toSorted((a, b) => at(a) - at(b)),
      },
      latest: latestEdit(schema, members.map(idOf)),
    };
  });
  return groups
    .toSorted((a, b) => (a.latest === b.latest ? 0 : a.latest > b.latest ? -1 : 1))
    .map(({ group }) => group);
}
