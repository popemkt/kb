export { DatalogError } from "./datalog-error.ts";
export { DatascriptIndex } from "./index/datascript-index.ts";
export { derivedWith, nodeMentions } from "./index/derived.ts";
export type { DerivedRef, KeyRef, ValueRefCarrier } from "./index/derived.ts";
export { KbIndexService } from "./index/index.ts";
export type { KbIndex, NodeIndex } from "./index/index.ts";
export {
  answered,
  classifyQueryError,
  datalogRows,
  engineOf,
  QueryEngineService,
  QueryError,
} from "./index/engine.ts";
export type { EdnRunner, QueryEngine } from "./index/engine.ts";
export { answerOf } from "./index/answer.ts";
export type { QueryAnswer, QueryRequest, QueryTransport } from "./index/answer.ts";
export { inThreadPort, RemoteIndex, serveIndex } from "./index/remote.ts";
export type { EnginePort, FromEngine, Timers, ToEngine } from "./index/remote.ts";
export { normalizeEdnQuery } from "./ir/compile.ts";
export { parseEdn } from "./ir/parse.ts";
export { readsAsEdn } from "./ir/edn.ts";
export { printEdn } from "./ir/print.ts";
export { canonicalConditions, lift, lowerIr } from "./ir/conditions.ts";
export { conditionGraph, conditionsMatcher } from "./ir/evaluate.ts";
export type {
  CompareOp,
  Condition,
  ConditionEdge,
  ConditionOf,
  ConditionRow,
  ConditionValue,
  GroupOf,
  Lifted,
} from "./ir/conditions.ts";
export { queryRecords } from "./records.ts";
export type { QueryRecords } from "./records.ts";
export {
  LIST_ALL_NODES_QUERY,
  LIST_FIELDS_QUERY,
  LIST_TAGS_QUERY,
  backlinksQuery,
  neighbourhoodQuery,
} from "./queries.ts";
