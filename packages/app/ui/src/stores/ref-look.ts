import { refLookOf, schemaOf, type RefLook } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";

/**
 * How references in rendered text read (`RefLook`), from the graph the
 * store holds: `refLookOf` over the whole-graph schema. It lives beside the
 * store for the reason `useFollow` does — the surfaces that render text are
 * primitives, handed it as a prop, and every surface wants the same one.
 */
export function useRefLook(): RefLook {
  return useGraphStore(refLookIn);
}

/** The look for the graph `state` holds: one object per schema, so a reader may compare it. */
export function refLookIn(state: Parameters<typeof schemaOf>[0]): RefLook {
  return refLookOf(schemaOf(state));
}
