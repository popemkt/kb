/** A day section's rows: one per node, opening it, or a quiet line when there are none. */
import type { ReactNode } from "react";
import { useNodes, useOpenNode } from "@kb/ui-sdk";
import { textOf } from "./touched";

export interface NodeRow {
  readonly id: string;
  /** What the row says beside the node, quieter. */
  readonly note?: string;
}

export function NodeRows({ rows }: { readonly rows: readonly NodeRow[] }): ReactNode {
  const nodes = useNodes();
  const open = useOpenNode();
  if (rows.length === 0) return <p className="px-2 text-meta text-foreground/30">Nothing yet.</p>;
  return (
    <ul>
      {rows.map(({ id, note }) => (
        <li key={id}>
          <button
            type="button"
            className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-ui hover:bg-foreground/5"
            onClick={() => open(id)}
          >
            <span className="truncate">{textOf(nodes.get(id))}</span>
            {note === undefined ? null : (
              <span className="shrink-0 text-meta text-foreground/40">{note}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
