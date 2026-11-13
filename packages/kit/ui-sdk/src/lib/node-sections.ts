/**
 * Sections below a node's outline, contributed per tag (DESIGN-UI.md →
 * Node pages → sections below the outline): what a family shows on the
 * page of a node that is one of its tags, under the node's own outline and
 * its References. A node is a tag through the tags it carries and what
 * they extend, so a person's `#my day` that extends `#day` shows `#day`'s
 * sections. The page draws each section's title; its body is the
 * contributor's.
 */
import { useMemo, type ComponentType } from "react";
import { CORE_POINT_DEFINITIONS } from "@kb/contracts";
import { tagChains } from "@kb/model";
import { Point, type Contribution } from "@kb/plugin";
import { useSchema } from "../hooks";
import { useContributions } from "./plugins.ts";
import type { SchemaIndex } from "./schema";

/** What a section is drawn for: the page's node. */
export interface NodeSectionProps {
  readonly id: string;
}

export interface NodeSection {
  /** The tags whose nodes show it. */
  readonly tags: readonly string[];
  /** Lower first. */
  readonly order: number;
  /** Its heading. */
  readonly title: string;
  /** Whether it shows now, read from the graph (a family's setting, say); always when absent. */
  readonly shown?: (nodes: SchemaIndex) => boolean;
  readonly Component: ComponentType<NodeSectionProps>;
}

export const NodeSectionPoint = Point<NodeSection>()(
  CORE_POINT_DEFINITIONS.nodeSection.name,
  CORE_POINT_DEFINITIONS.nodeSection.spec,
);

/** A section to draw: its contribution id, and what it was contributed with. */
export type ShownSection = NodeSection & { readonly id: string };

/** The sections `id`'s page shows over `nodes`, in ascending order. */
export function nodeSectionsOf(
  id: string,
  nodes: SchemaIndex,
  contributed: readonly Contribution<NodeSection>[],
): readonly ShownSection[] {
  const node = nodes.get(id);
  if (node === undefined || contributed.length === 0) return [];
  const kinds = new Set(tagChains((tag) => nodes.get(tag)).kindsOf(node));
  return contributed
    .filter(
      ({ value }) => value.tags.some((tag) => kinds.has(tag)) && (value.shown?.(nodes) ?? true),
    )
    .map(({ id: section, value }) => ({ ...value, id: section }))
    .toSorted((a, b) => a.order - b.order);
}

/** {@link nodeSectionsOf} for the page of `id`, following the graph and the point. */
export function useNodeSections(id: string): readonly ShownSection[] {
  const nodes = useSchema();
  const contributed = useContributions(NodeSectionPoint);
  return useMemo(() => nodeSectionsOf(id, nodes, contributed), [id, nodes, contributed]);
}
