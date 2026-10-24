/**
 * MemoryTxTail against the shared tail contract: the tail a store without a
 * file has (the browser's replica, fixtures) records and pages as the durable
 * ones do. The durable tails run the same contract in their own packages.
 */
import { Effect } from "effect";
import { MemoryTxTail } from "@kb/tx-log";
import { tailContract } from "../src/index.ts";

tailContract(
  "MemoryTxTail",
  Effect.sync(() => new MemoryTxTail()),
);
