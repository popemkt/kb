/** "Dated this day" (DESIGN-UI.md → Days): every node holding the day in a date field. */
import { useMemo } from "react";
import { datedOn } from "@kb/days";
import { useNodes } from "@kb/ui-sdk";
import { NodeRows } from "./node-rows";
import type { DaySectionProps } from "./sections";
import { textOf } from "./touched";

export function DatedSection({ day }: DaySectionProps) {
  const nodes = useNodes();
  const rows = useMemo(
    () => datedOn(nodes, day).map(({ id, field }) => ({ id, note: textOf(nodes.get(field)) })),
    [nodes, day],
  );
  return <NodeRows rows={rows} />;
}
