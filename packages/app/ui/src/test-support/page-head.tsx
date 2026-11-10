import {
  HeadBackdropFrame,
  PageBackdrop,
  PageBackdropHost,
  usePageBackdrop,
  type OutlineNode,
} from "@kb/ui-sdk";
import { PageFrame } from "@/components/layout/pane-frame";

interface Head {
  readonly color: string;
  readonly node?: OutlineNode;
}

/**
 * A page head in a pane, as the shell draws it: the pane's backdrop host
 * above a scroll region, and the head's slot in the page.
 */
export function PaneWithHead(head: Head) {
  return (
    <PageBackdropHost>
      <PageFrame frame="scroll">
        <PageBackdrop {...head} />
      </PageFrame>
    </PageBackdropHost>
  );
}

/**
 * The frame a head's choice draws, with no pane around it: what a render
 * that runs no effects (`renderToStaticMarkup`, `prerender`) can show, since
 * a head reaches its host by declaring itself from an effect.
 */
export function HeadFrame({ color, node }: Head) {
  const choice = usePageBackdrop(node);
  return <HeadBackdropFrame color={color} node={node} choice={choice} />;
}
