/** Binding edits and changes to their field definitions obey the same protocol constraints. */
import { Effect } from "effect";
import type { ActionGuard } from "@kb/contracts";
import { canonicalJson, fieldTypeOptionOf, SYSTEM_IDS, type NodeLike } from "@kb/model";
import { CANVAS_RUN_FIELDS, canvasRunBindingsOf } from "./run-fields.ts";

export const canvasRunFieldGuard: Omit<ActionGuard, "match"> = {
  commit: (call) =>
    Effect.sync(() => {
      const graph = new Map<string, NodeLike>(call.ctx.nodes.map((node) => [node.id, node]));
      const bindingsChanged = new Set<string>();
      const definitionsChanged = new Set<string>();
      for (const { before, after } of call.writes) {
        const id = (after ?? before)?.id;
        if (id === undefined) continue;
        if (after === undefined) graph.delete(id);
        else graph.set(id, after);
        if (
          Object.values(CANVAS_RUN_FIELDS).some(
            ({ field }) =>
              canonicalJson(before?.props[field] ?? []) !==
              canonicalJson(after?.props[field] ?? []),
          )
        )
          bindingsChanged.add(id);
        if (
          after === undefined ||
          [SYSTEM_IDS.fieldTypeField, SYSTEM_IDS.cardinalityField].some(
            (field) =>
              canonicalJson(before?.props[field] ?? []) !== canonicalJson(after.props[field] ?? []),
          )
        )
          definitionsChanged.add(id);
      }
      for (const node of graph.values()) {
        const affected =
          bindingsChanged.has(node.id) ||
          Object.values(CANVAS_RUN_FIELDS).some(({ field }) => {
            const value = node.props[field]?.[0];
            if (value?.t !== "ref") return false;
            const target = graph.get(value.v);
            const option = fieldTypeOptionOf(target?.props);
            return (
              definitionsChanged.has(value.v) || (option !== null && definitionsChanged.has(option))
            );
          });
        if (!affected) continue;
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
