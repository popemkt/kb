import { lazy } from "react";
import { ImagesSquareIcon } from "@phosphor-icons/react";
import { GalleryView, type ComposerParams } from "@kb/gallery";
import {
  navigate,
  paramsOf,
  SidebarRow,
  SidebarSection,
  ViewErrorBoundary,
  type MatchedRoute,
  type ViewProps,
} from "@kb/ui-sdk";
import { GALLERY_PATH } from "./routes";

/** The page, its panels and its workflows stay in the gallery's own chunks. */
const ComposerPage = lazy(() => import("./composer-page"));

export function GallerySurface({ params }: ViewProps<ComposerParams>) {
  return (
    <ViewErrorBoundary title="Gallery crashed" resetKey={`gallery|${params.workflow ?? ""}`}>
      <ComposerPage params={params} />
    </ViewErrorBoundary>
  );
}

export function GallerySection({ route }: { readonly route: MatchedRoute | null }) {
  return (
    <SidebarSection>
      <SidebarRow
        label="Gallery"
        icon={<ImagesSquareIcon size={14} />}
        active={paramsOf(route, GalleryView) !== null}
        onClick={() => navigate(GALLERY_PATH)}
      />
    </SidebarSection>
  );
}
