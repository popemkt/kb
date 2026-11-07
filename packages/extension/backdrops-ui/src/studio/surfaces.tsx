import { lazy } from "react";
import type { BackdropStudioParams } from "@kb/backdrops";
import { ViewErrorBoundary, type ViewProps } from "@kb/ui-sdk";

/** The studio and every scene it shows stay in their own chunks: the main bundle must not grow. */
const StudioPage = lazy(() => import("./studio-page"));

export function StudioSurface({ params }: ViewProps<BackdropStudioParams>) {
  return (
    <ViewErrorBoundary title="Backdrop Studio crashed" resetKey={params.backdrop ?? ""}>
      <StudioPage {...params} />
    </ViewErrorBoundary>
  );
}
