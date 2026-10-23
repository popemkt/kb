import { useCallback } from "react";
import { HouseIcon } from "@phosphor-icons/react";
import { HomeView } from "@kb/views";
import {
  type MatchedRoute,
  paramsOf,
  schemaOf,
  SidebarRow,
  SidebarSection,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { DefaultViewSlot } from "@/lib/default-view";
import { useGraphStore } from "@/stores/graph.store";

/**
 * Where the page stands (`HomeView`, at `/` and `/outline/<id>`): its zoom,
 * in the store's default view type for no node (`DefaultViewSlot`): the
 * outline, which provides the default view type, at the zoom.
 */
export function HomeSurface() {
  const schema = useGraphStore(schemaOf);
  const lookup = useCallback((id: string) => schema.get(id), [schema]);
  return <DefaultViewSlot subject={WORKSPACE_ROOT_ID} lookup={lookup} warnAs="home" />;
}

/** The sidebar's way home: the page zoomed to the workspace, or to the ontology while scoped. */
export function HomeSection({ route }: { readonly route: MatchedRoute | null }) {
  const rootNodeId = useGraphStore((s) => s.rootNodeId);
  const homeRootId = useGraphStore((s) => s.homeRootId);
  return (
    <SidebarSection>
      <SidebarRow
        label="Home"
        icon={<HouseIcon size={14} />}
        active={paramsOf(route, HomeView) !== null && rootNodeId === homeRootId}
        onClick={() => useGraphStore.getState().zoomHome()}
      />
    </SidebarSection>
  );
}
