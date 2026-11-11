/**
 * The sections families contribute below a node's outline, for the tags it
 * is (`NodeSectionPoint`; DESIGN-UI.md → Node pages → sections below the
 * outline). Each is titled as References is, and its body, which may be a
 * chunk of its own, loads in place.
 */
import { Suspense } from "react";
import { useNodeSections } from "@kb/ui-sdk";

export function NodeSections({ nodeId }: { readonly nodeId: string }) {
  const sections = useNodeSections(nodeId);
  return sections.map(({ id, title, Component }) => (
    <section key={id} className="node-section" data-node-section={id}>
      <h2 className="mb-1 mt-3 text-meta kb-label text-foreground/30">{title}</h2>
      <Suspense fallback={null}>
        <Component id={nodeId} />
      </Suspense>
    </section>
  ));
}
