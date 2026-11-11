/** Validate bindings when a write changes their configuration or any node the validator reads. */
import { Effect } from "effect";
import type { ActionGuard } from "@kb/contracts";
import { canonicalJson, type NodeLike } from "@kb/model";
import { CANVAS_RUN_FIELDS, canvasRunBindingsOf } from "./run-fields.ts";

export const canvasRunFieldGuard: Omit<ActionGuard, "match"> = {
  commit: (call) =>
    Effect.sync(() => {
      const graph = new Map<string, NodeLike>(call.ctx.nodes.map((node) => [node.id, node]));
      const changed = new Set<string>();
      for (const { before, after } of call.writes) {
        const id = (after ?? before)?.id;
        if (id === undefined) continue;
        changed.add(id);
        if (after === undefined) graph.delete(id);
        else graph.set(id, after);
      }
      for (const node of graph.values()) {
        if (!Object.values(CANVAS_RUN_FIELDS).some(({ field }) => node.props[field] !== undefined))
          continue;
        const before = call.nodeOf(node.id);
        const bindingChanged = Object.values(CANVAS_RUN_FIELDS).some(
          ({ field }) =>
            canonicalJson(before?.props[field] ?? []) !== canonicalJson(node.props[field] ?? []),
        );
        const dependencies = new Set<string>();
        if (before !== undefined) {
          try {
            canvasRunBindingsOf(before, (id) => {
              dependencies.add(id);
              return call.nodeOf(id);
            });
          } catch {
            // Imported invalid bindings do not block unrelated edits; repair is
            // checked when a write touches their configuration or dependencies.
          }
        }
        if (!bindingChanged && ![...dependencies].some((id) => changed.has(id))) continue;
        try {
          canvasRunBindingsOf(node, (id) => graph.get(id));
        } catch (error) {
          return {
            decision: "deny" as const,
            rule: "canvas.run-fields",
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
      return { decision: "allow" as const };
    }),
};
