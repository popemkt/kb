import { Suspense, useContext, useMemo, type ReactElement } from "react";
import { EnclosingSlots } from "./slot-chain";
import { ViewErrorBoundary } from "./view-error-boundary";
import {
  useView,
  type Drawn,
  type Placement,
  type RowSubject,
  type ViewHost,
} from "../lib/plugins";
import { slotLink, slotRenders, type SlotChain } from "../lib/view-key";
import type { ViewKey } from "@kb/views";

/** What a slot shows while its view loads: a quiet placeholder of the box, never a blank. */
const PENDING = (
  <div
    aria-busy="true"
    data-view-pending="true"
    className="min-h-6 rounded-sm bg-foreground/[0.04] motion-safe:animate-pulse"
  />
);

/** What a slot is handed beside where it draws (`Drawn`). */
interface SlotProps<P> {
  readonly view: ViewKey<P>;
  readonly params: P;
  /**
   * Shown while no view is provided under `view`, when it does not offer
   * the placement, when `slotRenders` refuses it, and at `row` when no row
   * came with it.
   */
  readonly fallback: ReactElement;
  /**
   * What the host shows the view for (a frame's id, a perspective's), when it
   * may show the same view for another: the error boundary resets when it
   * changes, and it tells a view going on down its tree from a cycle.
   */
  readonly subject?: string;
  /** The view node the view is drawn from, when it is drawn from one (`ViewHost.viewNode`). */
  readonly viewNode?: string;
  /** Shown in the slot's box while the view's code or data is still loading. */
  readonly pending?: ReactElement | null;
}

/**
 * Where a slot draws, as it hands it on: the row only at `row`, and `null`
 * for a slot at `row` handed none, which a caller outside the types (a page
 * half's untyped JSX) can still write.
 */
function drawnOf(placement: Placement, row: RowSubject | undefined): Drawn | null {
  if (placement !== "row") return { placement };
  return row === undefined ? null : { placement, row };
}

/**
 * The one way to render a view: the shell's page, and one plugin embedding
 * another's view by key, without importing it. What it promises is stated
 * once, in DESIGN-UI.md → UI points: routes and views.
 *
 * Whether it renders is `slotRenders` over the slots around it: a slot that
 * would show the same view for the same subject as any slot around it is a
 * cycle, and shows its fallback; so is one past `MAX_VIEW_DEPTH`.
 */
export function ViewSlot<P>(props: SlotProps<P> & Drawn) {
  const { view, params, fallback, subject, viewNode, pending = PENDING } = props;
  const provided = useView(view);
  const outer = useContext(EnclosingSlots);
  const { placement, row } = props;
  const host = useMemo((): ViewHost | null => {
    const drawn = drawnOf(placement, row);
    if (drawn === null) return null;
    return viewNode === undefined ? drawn : { ...drawn, viewNode };
  }, [placement, row, viewNode]);
  const link = slotLink(view, subject);
  const chain = useMemo((): SlotChain => [...outer, link], [outer, link]);
  if (
    host === null ||
    provided === null ||
    !provided.placements.includes(placement) ||
    !slotRenders(outer, link)
  )
    return fallback;
  const { Component } = provided;
  // A view that throws is contained here: its box shows the error, its host
  // stays up. A view that suspends waits here too, so its host never blanks.
  return (
    <EnclosingSlots.Provider value={chain}>
      <ViewErrorBoundary title="View crashed" resetKey={link}>
        <Suspense fallback={pending}>
          <Component params={params} host={host} />
        </Suspense>
      </ViewErrorBoundary>
    </EnclosingSlots.Provider>
  );
}
