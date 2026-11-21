/**
 * A row that names a node another node's page lists and opens it: a
 * reference, a section's entry (DESIGN-UI.md → Node pages → sections below
 * the outline). It reads as an outline row does, with the node's bullet,
 * its text drawn as markdown with its refs followed, and its tags, but it
 * is not the node's place: clicking it opens the node.
 */
import type { ReactNode } from "react";
import { useFollow, useNodes, useOpenNode, useRefLook } from "../hooks";
import { cn } from "../lib/cn";
import { bulletClickIntent, nodeTarget } from "../lib/follow";
import type { OutlineNode, TagBadge } from "../lib/types";
import { Bullet } from "./bullet";
import { MdView } from "./md-view";
import { NodeRow } from "./node-row";
import { TagChipGroup } from "./tag-chip";

/** Whether what the list draws under the row is shown, and how to switch it. */
interface NodeLinkFold {
  readonly open: boolean;
  readonly toggle: () => void;
}

interface NodeLinkRowProps {
  readonly id: string;
  /** The text it reads, as its row would draw it. */
  readonly text: string;
  readonly tags: readonly TagBadge[];
  /** What comes before its text: how the page's node relates to it, say. */
  readonly leading?: ReactNode;
  /** Indent steps before the row, as an outline row's depth. */
  readonly depth?: number;
  /**
   * What the list draws under the row folds by its bullet, as an outline
   * row's children do (`bulletClickIntent`): a plain click toggles it, a
   * ⌘/Ctrl-click opens the node, and a closed row's bullet has its halo.
   * Without one, the bullet opens the node.
   */
  readonly fold?: NodeLinkFold | undefined;
  /**
   * An action on the node the row names (Link, say). It is drawn over the
   * row's right end while the row is hovered or holds focus, and takes no
   * width, so showing it never moves the row's words (DESIGN-UI.md →
   * "Row actions take no width").
   */
  readonly action?: ReactNode;
}

export function NodeLinkRow({
  id,
  text,
  tags,
  leading,
  depth = 0,
  fold,
  action,
}: NodeLinkRowProps) {
  const open = useOpenNode();
  const follow = useFollow();
  const refs = useRefLook();
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
      depth={depth}
      nodeId={id}
      className={cn("w-full text-left", action !== undefined && "relative")}
      onRowClick={() => open(id)}
      bullet={
        <Bullet
          node={bulletNode}
          isRef
          collapsible={fold !== undefined}
          collapsed={fold !== undefined && !fold.open}
          onClick={(e) => {
            e.stopPropagation();
            const intent = bulletClickIntent(e, fold !== undefined);
            if (intent === "toggle") fold?.toggle();
            else if (intent === "beside") follow(nodeTarget(id), "beside");
            else open(id);
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
            refs={refs}
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
          {action !== undefined && <RowAction>{action}</RowAction>}
        </>
      }
    />
  );
}

/**
 * The row's action, laid over its right end: absolute, so it takes no
 * width; shown while the row is hovered or something in it holds focus,
 * and always where nothing hovers; on a ground of the page's own colour,
 * faded in from the left, so the words under it stay legible up to it.
 * Hidden, it takes no clicks, so a click there still opens the row.
 * NodeBlock's view toolbar lays itself over its row on its own terms.
 * GAP [[01M7ZN612X0JRVRG29RARKF1DR]]
 */
function RowAction({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className={cn(
        "absolute right-0 top-0 flex items-center pl-6 pr-1",
        "bg-linear-to-r from-transparent via-background via-40% to-background",
        "pointer-events-none opacity-0 transition-opacity duration-100",
        "group-hover/node:pointer-events-auto group-hover/node:opacity-100",
        "group-focus-within/node:pointer-events-auto group-focus-within/node:opacity-100",
        "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
      )}
      style={{ height: "var(--kb-row-h)" }}
      data-row-action="true"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
