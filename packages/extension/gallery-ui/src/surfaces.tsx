import { lazy } from "react";
import { ImagesSquareIcon } from "@phosphor-icons/react";
import { GalleryView } from "@kb/gallery";
import {
  navigate,
  paramsOf,
  SidebarRow,
  SidebarSection,
  ViewErrorBoundary,
  type MatchedRoute,
} from "@kb/ui-sdk";
import { GALLERY_PATH } from "./routes";

/** The page and its panels stay in the gallery's own chunk. */
const GalleryPage = lazy(() => import("./gallery-page"));

export function GallerySurface() {
  return (
    <ViewErrorBoundary title="Gallery crashed" resetKey="gallery">
      <GalleryPage />
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
