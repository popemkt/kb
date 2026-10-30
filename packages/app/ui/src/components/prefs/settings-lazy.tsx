import { lazy, Suspense } from "react";
import type { ViewProps } from "@kb/ui-sdk";
import type { SettingsParams } from "@kb/views";

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
