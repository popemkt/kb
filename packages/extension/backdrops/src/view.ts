/**
 * Backdrop Studio's view (DESIGN-UI.md → Backdrop Studio): one page that
 * shows every backdrop contributed, as a gallery, or one of them as a scene
 * of its own, with its knobs. Its params come from the route, so a view
 * node stores none; this module is its vocabulary.
 */
import { Schema } from "effect";
import { viewKey } from "@kb/views";

/** The namespace of the studio view's id: what draws it, the backdrops family. */
const BACKDROPS_NAMESPACE = "backdrops";

export const BackdropStudioParams = Schema.Struct({
  /** The backdrop shown, by its declared id (`SeedBackdrop.id`); absent means the gallery. */
  backdrop: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({
  description:
    "Backdrop Studio: the gallery of backdrops, or one backdrop as a scene with its knobs. Its params come from the route: a view node holds none.",
});
export type BackdropStudioParams = typeof BackdropStudioParams.Type;

/** Backdrop Studio: the gallery, or one backdrop. */
export const BackdropStudioView = viewKey(
  `${BACKDROPS_NAMESPACE}.studio`,
  "Backdrop Studio",
  BackdropStudioParams,
);
