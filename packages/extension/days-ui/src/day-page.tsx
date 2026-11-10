/**
 * The day page (DESIGN-UI.md → Days): `#day`'s default view. The day's own
 * outline, then what was made or edited on it, in the page's local day.
 */
import { useMemo } from "react";
import { Effect } from "effect";
import type { DayParams } from "@kb/days";
import { keyOf, textOf, touchedOn, type Stamped } from "./touched";
import { clockSampler } from "@kb/model";
import { useNodes, useOpenNode, ViewSlot, type ViewProps } from "@kb/ui-sdk";
import { OutlineView } from "@kb/views";

function pageZone(): string {
  return Effect.runSync(clockSampler)().timeZone;
}

export function DayPage({ params }: ViewProps<DayParams>) {
  const nodes = useNodes() as ReadonlyMap<string, Stamped>;
  const open = useOpenNode();
  const node = params.id === undefined ? undefined : nodes.get(params.id);
  const day = keyOf(node);
  const touched = useMemo(
    () => (day === null ? [] : touchedOn(nodes, day, pageZone())),
    [nodes, day],
  );
  if (node === undefined || day === null) {
    return <p className="p-6 text-ui text-foreground/50">This node is not a day.</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-day-page={day}>
      <ViewSlot
        view={OutlineView}
        params={{ root: node.id }}
        placement="page"
        fallback={<p className="px-6 text-meta text-foreground/40">The outline is off.</p>}
      />
      <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2" data-day-section="touched">
        <h2 className="mb-1.5 px-2 text-meta kb-label text-foreground/40">
          Made or edited this day
        </h2>
        {touched.length === 0 ? (
          <p className="px-2 text-meta text-foreground/30">Nothing yet.</p>
        ) : (
          <ul>
            {touched.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="w-full truncate rounded-md px-2 py-1 text-left text-ui hover:bg-foreground/5"
                  onClick={() => open(id)}
                >
                  {textOf(nodes.get(id))}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
