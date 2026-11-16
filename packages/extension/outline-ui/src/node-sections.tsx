/**
 * The sections families contribute below a node's outline, for the tags it
 * is (`NodeSectionPoint`; DESIGN-UI.md → Node pages → sections below the
 * outline). Each is titled as References is, and its body, which may be a
 * chunk of its own, loads in place.
 */
import { Suspense } from "react";
import { useNodeSections } from "@kb/ui-sdk";
import { SectionHeading } from "./section-heading";

export function NodeSections({ nodeId }: { readonly nodeId: string }) {
  const sections = useNodeSections(nodeId);
  return sections.map(({ id, title, Component }) => (
    <section key={id} className="node-section" data-node-section={id}>
      <SectionHeading>{title}</SectionHeading>
      <Suspense fallback={null}>
        <Component id={nodeId} />
      </Suspense>
    </section>
  ));
}
