/** A day section's rows: one per node, opening it, or a quiet line when there are none. */
import type { ReactNode } from "react";
import { useNodes, useOpenNode } from "@kb/ui-sdk";
import { textOf } from "./touched";

export function NodeRows({ ids }: { readonly ids: readonly string[] }): ReactNode {
  const nodes = useNodes();
  const open = useOpenNode();
  if (ids.length === 0) return <p className="px-2 text-meta text-foreground/30">Nothing yet.</p>;
  return (
    <ul>
      {ids.map((id) => (
        <li key={id}>
          <button
            type="button"
            className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-ui hover:bg-foreground/5"
            onClick={() => open(id)}
          >
            <span className="truncate">{textOf(nodes.get(id))}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
