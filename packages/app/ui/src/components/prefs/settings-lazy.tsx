import { lazy, Suspense } from "react";

/** The page's body: loaded when Settings is first opened, not with the shell. */
const SettingsBody = lazy(() =>
  import("@/components/prefs/settings-page").then((m) => ({ default: m.SettingsPage })),
);

/** The Settings page as the shell holds it: its body loads on first open. */
export function LazySettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsBody />
    </Suspense>
  );
}
