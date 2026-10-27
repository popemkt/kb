import { GearSixIcon } from "@phosphor-icons/react";
import { lazy, Suspense } from "react";
import {
  type MatchedRoute,
  navigate,
  paramsOf,
  SETTINGS_PATH,
  SidebarRow,
  SidebarSection,
  type ViewProps,
} from "@kb/ui-sdk";
import { SettingsView, type SettingsParams } from "@kb/views";

/** The page's body: loaded when Settings is first opened, not with the shell. */
const SettingsBody = lazy(() =>
  import("@/components/prefs/settings-page").then((m) => ({ default: m.SettingsPage })),
);

/** The Settings page as the shell holds it: its body loads on first open. */
export function LazySettingsPage({ params }: ViewProps<SettingsParams>) {
  return (
    <Suspense fallback={null}>
      <SettingsBody part={params.part} />
    </Suspense>
  );
}

/** The sidebar's way in, lit on every part. */
export function SettingsSidebarSection({ route }: { readonly route: MatchedRoute | null }) {
  return (
    <SidebarSection>
      <SidebarRow
        label="Settings"
        icon={<GearSixIcon size={14} />}
        active={paramsOf(route, SettingsView) !== null}
        onClick={() => navigate(SETTINGS_PATH)}
      />
    </SidebarSection>
  );
}
