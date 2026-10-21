export { DatalogError } from "./datalog-error.ts";
export { datascriptExecutor, pull, query, queryRows, runIr } from "./datascript.ts";
export type { EdnExecutor } from "./datascript.ts";
export { DatascriptIndex } from "./index/datascript-index.ts";
export type { IndexOptions } from "./index/datascript-index.ts";
export { derivedWith, nodeMentions } from "./index/derived.ts";
export type { DerivedRef, DerivedSources, FieldRefCarrier } from "./index/derived.ts";
export { KbIndexService } from "./index/index.ts";
export type { KbIndex, NodeIndex } from "./index/index.ts";
export { NodeTable } from "./index/node-table.ts";
export { answered, engineOf, QueryEngineService, QueryError } from "./index/engine.ts";
export type { EdnRunner, QueryEngine } from "./index/engine.ts";
export { answerOf } from "./index/answer.ts";
export type { QueryAnswer, QueryRequest, QueryTransport } from "./index/answer.ts";
export { inThreadPort, RemoteIndex, serveIndex } from "./index/remote.ts";
export type { EnginePort, FromEngine, Timers, ToEngine } from "./index/remote.ts";
export type { NodeChange } from "./index/node-table.ts";
export { compile, normalizeEdnQuery } from "./ir/compile.ts";
export { findColumns, parseEdn } from "./ir/parse.ts";
export { isCanonicalIr } from "./ir/canonical.ts";
export { printEdn } from "./ir/print.ts";
export { queryRecords } from "./records.ts";
export type { QueryRecords } from "./records.ts";
export { PREDICATES } from "./ir/ir.ts";
export type { Clause, Ir, IrQuery, IrRaw, PredicateArg, PredicateName, Term } from "./ir/ir.ts";
export {
  BACKLINKS_IR,
  LIST_ALL_NODES_IR,
  LIST_ALL_NODES_QUERY,
  LIST_FIELDS_IR,
  LIST_FIELDS_QUERY,
  LIST_TAGS_IR,
  LIST_TAGS_QUERY,
  backlinksQuery,
  neighbourhoodQuery,
} from "./queries.ts";
export type { NeighbourhoodDirection } from "./queries.ts";
