import { useState } from "react";
import { cn } from "@kb/ui-sdk";

/**
 * How many nodes a query node answers, from the one answer its results read
 * (DESIGN-UI.md → Replica queries: one execution per query): the distinct
 * result nodes, or that the run took longer than its budget — a slow query
 * is not a large one, so no number is shown for it — or nothing known yet.
 */
export type QueryCount =
  | { readonly t: "nodes"; readonly n: number }
  | { readonly t: "over-budget" }
  | { readonly t: "pending" }
  | { readonly t: "failed" };

/**
 * The live count beside a query node's tabs ("12 nodes"). While the query
 * is being answered again, or its text does not parse (`stale`), it shows
 * the last count it had, dimmed.
 */
export function CountChip({ count, stale }: { count: QueryCount; stale: boolean }) {
  const [last, setLast] = useState<number | null>(null);
  if (count.t === "nodes" && count.n !== last) setLast(count.n);
  const shown = count.t === "nodes" ? count.n : last;
  const chip = cn(
    "rounded-full bg-primary/10 px-1.5 text-label text-primary transition-opacity",
    "tabular-nums",
  );
  if (count.t === "over-budget") {
    return (
      <span className={chip} role="status" data-qb-count="over-budget">
        took too long to count
      </span>
    );
  }
  if (shown === null) return null;
  const dim = stale || count.t !== "nodes";
  return (
    <span
      className={cn(chip, dim && "opacity-45")}
      role="status"
      aria-label={dim ? `${shown} nodes when last counted` : `${shown} nodes`}
      data-qb-count={dim ? "stale" : "current"}
    >
      {shown} {shown === 1 ? "node" : "nodes"}
    </span>
  );
}
