/** The Today row (DESIGN-UI.md → Days): under Home, opening today's node. */
import { SunIcon } from "@phosphor-icons/react";
import { periodNodeOf } from "@kb/days";
import { paramsOf, SidebarRow, SidebarSection, useNodes, type MatchedRoute } from "@kb/ui-sdk";
import { NodeView } from "@kb/views";
import { openToday, pageDay } from "./today";

export function TodaySection({ route }: { readonly route: MatchedRoute | null }) {
  const nodes = useNodes();
  const today = periodNodeOf(nodes.values(), pageDay());
  return (
    <SidebarSection>
      <SidebarRow
        label="Today"
        icon={<SunIcon size={14} />}
        active={today !== null && paramsOf(route, NodeView)?.node === today}
        onClick={() => void openToday()}
      />
    </SidebarSection>
  );
}
