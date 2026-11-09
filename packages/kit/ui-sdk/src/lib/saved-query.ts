/**
 * A saved query as a T0 form names one (DESIGN-UI.md → The node menu): a
 * query node, by id, whose first column answers node ids. The replica
 * answers it in its own time ({@link QueryAnswers}), so a reader reads the
 * last answer, and a menu that shows it re-reads when an answer arrives
 * (`useAnswers`).
 */
import { queryTextOf } from "@kb/model";
import { browserHost } from "../host";

/** One set per answer's rows: an answer that did not move keeps its rows array. */
const IDS = new WeakMap<readonly unknown[][], ReadonlySet<string>>();

function idsOf(rows: readonly unknown[][]): ReadonlySet<string> {
  const known = IDS.get(rows);
  if (known !== undefined) return known;
  const ids = new Set(rows.flatMap((row) => (typeof row[0] === "string" ? [row[0]] : [])));
  IDS.set(rows, ids);
  return ids;
}

/**
 * The node ids the query node `queryId` answers now, its rows' first
 * column; null while it has no answer, when its answer is no rows, or when
 * `queryId` is no query node.
 */
export function savedQueryIds(queryId: string): ReadonlySet<string> | null {
  const host = browserHost();
  const edn = queryTextOf(host.node(queryId))?.trim() ?? "";
  const queries = host.queries();
  if (edn === "" || queries === null) return null;
  const { answer } = queries.read(edn);
  return answer?.kind === "rows" ? idsOf(answer.rows) : null;
}
