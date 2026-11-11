/** "Made or edited this day" (DESIGN-UI.md → Days), in the page's local day. */
import { useMemo } from "react";
import { Effect } from "effect";
import { clockSampler } from "@kb/model";
import { useNodes } from "@kb/ui-sdk";
import { NodeRows } from "./node-rows";
import type { DaySectionProps } from "./sections";
import { touchedOn, type Stamped } from "./touched";

function pageZone(): string {
  return Effect.runSync(clockSampler)().timeZone;
}

export function TouchedSection({ day }: DaySectionProps) {
  const nodes = useNodes() as ReadonlyMap<string, Stamped>;
  const ids = useMemo(() => touchedOn(nodes, day, pageZone()), [nodes, day]);
  return <NodeRows ids={ids} />;
}
