import { checkExtension } from "@kb/check";
import { Effect } from "effect";
import {
  ActionPoint,
  extensionNamespace,
  provideAction,
  type ExtensionAction,
} from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { checkAuditEffect } from "./audit.ts";
import { checkGapsEffect } from "./gaps.ts";
import { auditOutput, emptyInput, gapsInput, gapsOutput, syncOutput } from "./model.ts";
import { checkSyncEffect } from "./sync.ts";

const actions: ExtensionAction[] = [
  {
    id: "audit",
    title: "Audit checks",
    description: "Prove rule check references, evidence, wiring, enforcement, gates, and homes",
    mode: { kind: "read" },
    inputSchema: emptyInput,
    outputSchema: auditOutput,
    effect: checkAuditEffect,
  },
  {
    id: "gaps",
    title: "Audit gap markers",
    description: "Prove every gap marker in the listed files names an open #gap node",
    mode: { kind: "read" },
    inputSchema: gapsInput,
    outputSchema: gapsOutput,
    effect: checkGapsEffect,
  },
  {
    id: "sync",
    title: "Sync rule enforcement",
    description: "Derive each rule's stored enforcement from its referenced check surface",
    mode: { kind: "write" },
    inputSchema: emptyInput,
    outputSchema: syncOutput,
    effect: checkSyncEffect,
  },
];

/** The check family's server entry: `ext.check.*`. */
export const checkPlugin = definePlugin({
  name: checkExtension.name,
  namespace: extensionNamespace(checkExtension.name),
  apply: (ctx) =>
    Effect.forEach(actions, (action) => ctx.contribute(ActionPoint, provideAction(action)), {
      discard: true,
    }),
});
export { checkAuditEffect } from "./audit.ts";
export { checkSyncEffect } from "./sync.ts";
export { auditOutput, findingSchema, syncOutput } from "./model.ts";
export type { Finding } from "./model.ts";
