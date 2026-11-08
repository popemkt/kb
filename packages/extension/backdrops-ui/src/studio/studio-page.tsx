/**
 * Backdrop Studio's page (DESIGN-UI.md → Backdrop Studio): the gallery, or
 * one backdrop's scene. This module and everything below it load only when
 * the studio is opened; a scene's own code loads only when it is shown.
 */
import type { BackdropStudioParams } from "@kb/backdrops";
import { BackdropPoint, useContributions, WorkspaceState } from "@kb/ui-sdk";
import { familyOf, usePluginExtensions } from "./plugin-extensions";
import { StudioGallery } from "./studio-gallery";
import { StudioScene } from "./studio-scene";

export default function StudioPage({ backdrop }: BackdropStudioParams) {
  const contributed = useContributions(BackdropPoint);
  const plugins = usePluginExtensions();
  if (backdrop === undefined) return <StudioGallery plugins={plugins} />;
  const shown = contributed.find(({ value }) => value.key.id === backdrop);
  if (shown === undefined)
    return (
      <WorkspaceState
        title="No such backdrop"
        description="Nothing contributes it now: the extension it belongs to may be off."
      />
    );
  const family = familyOf(shown.owner);
  return (
    <StudioScene
      key={backdrop}
      id={backdrop}
      backdrop={shown.value}
      from={plugins.rows.has(family) ? family : null}
    />
  );
}
