import {
  AgentCompleteAction,
  FamilyKernels,
  GraphEdgesAction,
  ScriptListAction,
  ScriptRunAction,
} from "@kb/contracts";
import { Effect } from "effect";
import { Service, definePlugin, type ServiceKey } from "@kb/plugin";

export const CanvasScripts = Service<{
  readonly list: typeof ScriptListAction.invoke;
  readonly run: typeof ScriptRunAction.invoke;
}>()("canvas.scripts");
export const CanvasModel = Service<typeof AgentCompleteAction.invoke>()("canvas.model");
export const CanvasGraph = Service<typeof GraphEdgesAction.invoke>()("canvas.graph");

/** Each optional part is admitted by the same contribution it will invoke. */
export const canvasCapabilities = [
  definePlugin({
    name: "scripts",
    inject: [ScriptListAction, ScriptRunAction],
    apply: (ctx) =>
      ctx.provide(CanvasScripts, { list: ScriptListAction.invoke, run: ScriptRunAction.invoke }),
  }),
  definePlugin({
    name: "model",
    inject: [AgentCompleteAction],
    apply: (ctx) => ctx.provide(CanvasModel, AgentCompleteAction.invoke),
  }),
  definePlugin({
    name: "graph",
    inject: [GraphEdgesAction],
    apply: (ctx) => ctx.provide(CanvasGraph, GraphEdgesAction.invoke),
  }),
];

/** A canvas action may still do work that needs none of its optional parts. */
export const canvasCapability = Effect.fn("canvas.capability")(function* <A>(key: ServiceKey<A>) {
  const registry = (yield* FamilyKernels).find(({ source }) => source === "registry");
  return registry?.kernel.service(key);
});
