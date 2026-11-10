/**
 * The day page (DESIGN-UI.md → Days): `#day`'s default view. The day's own
 * outline, then the sections plugins contribute to `days.sections`, in
 * ascending order.
 */
import { Suspense, useMemo } from "react";
import type { DayParams } from "@kb/days";
import { useContributions, useNodes, ViewSlot, type ViewProps } from "@kb/ui-sdk";
import { OutlineView } from "@kb/views";
import { DaySectionPoint } from "./sections";
import { keyOf } from "./touched";

export function DayPage({ params }: ViewProps<DayParams>) {
  const nodes = useNodes();
  const contributed = useContributions(DaySectionPoint);
  const sections = useMemo(
    () =>
      contributed.map(({ id, value }) => ({ id, ...value })).toSorted((a, b) => a.order - b.order),
    [contributed],
  );
  const node = params.id === undefined ? undefined : nodes.get(params.id);
  const day = keyOf(node);
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
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
        {sections.map(({ id, title, Component }) => (
          <section key={id} className="mb-5" data-day-section={id}>
            <h2 className="mb-1.5 px-2 text-meta kb-label text-foreground/40">{title}</h2>
            <Suspense fallback={null}>
              <Component id={node.id} day={day} />
            </Suspense>
          </section>
        ))}
      </div>
    </div>
  );
}
