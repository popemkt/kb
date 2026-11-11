/**
 * A row that names a node another node's page lists and opens it: a
 * reference, a section's entry (DESIGN-UI.md → Node pages → sections below
 * the outline). It reads as an outline row does, with the node's bullet,
 * its text drawn as markdown with its refs followed, and its tags, but it
 * is not the node's place: clicking it opens the node.
 */
import type { ReactNode } from "react";
import { useFollow, useNodes, useOpenNode, useRefInk } from "../hooks";
import type { OutlineNode, TagBadge } from "../lib/types";
import { Bullet } from "./bullet";
import { MdView } from "./md-view";
import { NodeRow } from "./node-row";
import { TagChipGroup } from "./tag-chip";

export interface NodeLinkRowProps {
  readonly id: string;
  /** The text it reads, as its row would draw it. */
  readonly text: string;
  readonly tags: readonly TagBadge[];
  /** What comes before its text: how the page's node relates to it, say. */
  readonly leading?: ReactNode;
}

export function NodeLinkRow({ id, text, tags, leading }: NodeLinkRowProps) {
  const open = useOpenNode();
  const follow = useFollow();
  const ink = useRefInk();
  const node = useNodes().get(id);
  // A node outside the page's scope is still named: its bullet is drawn from the row.
  const bulletNode: OutlineNode = node ?? {
    id,
    text,
    parentId: null,
    children: [],
    collapsed: true,
    props: {},
    createdAt: "",
    updatedAt: "",
    tags: [...tags],
  };

  return (
    <NodeRow
      depth={0}
      nodeId={id}
      className="w-full text-left"
      onRowClick={() => open(id)}
      bullet={
        <Bullet
          node={bulletNode}
          isRef
          onClick={(e) => {
            e.stopPropagation();
            open(id);
          }}
        />
      }
      content={
        <>
          {leading}
          <MdView
            text={text}
            className="min-w-0 flex-1 text-foreground/85"
            onFollow={follow}
            ink={ink}
          />
          {tags.length > 0 && (
            <TagChipGroup
              tags={[...tags]}
              onTagClick={(tag, e) => {
                e.stopPropagation();
                open(tag.id);
              }}
            />
          )}
        </>
      }
    />
  );
}
