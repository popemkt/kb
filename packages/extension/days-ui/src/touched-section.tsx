/**
 * "Made or edited" on a day's, week's or year's page (DESIGN-UI.md → Days):
 * the nodes made or edited within the period, in the page's local zone,
 * each a row that opens it.
 */
import { useMemo } from "react";
import { Effect } from "effect";
import { clockSampler } from "@kb/model";
import { NodeLinkRow, rowText, useNodes, useSchema, type NodeSectionProps } from "@kb/ui-sdk";
import { keyOf, touchedIn } from "./touched";

function pageZone(): string {
  return Effect.runSync(clockSampler)().timeZone;
}

export function TouchedSection({ id }: NodeSectionProps) {
  const nodes = useNodes();
  const schema = useSchema();
  const key = keyOf(nodes.get(id));
  const ids = useMemo(() => (key === null ? [] : touchedIn(nodes, key, pageZone())), [nodes, key]);
  if (ids.length === 0) return <p className="px-2 text-meta text-foreground/30">Nothing yet.</p>;
  return ids.flatMap((touched) => {
    const node = nodes.get(touched);
    if (node === undefined) return [];
    return [
      <NodeLinkRow key={touched} id={touched} text={rowText(node, schema)} tags={node.tags} />,
    ];
  });
}
