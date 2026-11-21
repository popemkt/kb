/**
 * The gallery family's server entry (DESIGN.md → Extension families): the
 * family's shared plugin, and its actions with their handlers,
 * `ext.gallery.search`, `ext.gallery.save`, `ext.gallery.capture` and
 * `ext.gallery.starter`. `fetch` is the platform's
 * unless a test hands it a fake source. The handlers, with the network and
 * image code they run, load with the family's first call, so a command that
 * makes none parses none of it.
 */
import { Effect } from "effect";
import {
  ActionPoint,
  extensionNamespace,
  familyTags,
  provideAction,
  type ExtensionAction,
} from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";
import {
  galleryCaptureDef,
  galleryExtension,
  galleryPlugin,
  gallerySaveDef,
  gallerySearchDef,
  galleryStarterDef,
} from "@kb/gallery";
import type * as Actions from "./actions.ts";
import type { SourceFetch } from "./http.ts";

type Handlers = typeof Actions;

/** A handler from the handlers module, which the first call loads. */
function loaded<I, A, E, R>(
  handler: (handlers: Handlers) => (input: I) => Effect.Effect<A, E, R>,
): (input: I) => Effect.Effect<A, E, R> {
  return (input) =>
    Effect.flatMap(
      Effect.promise(() => import("./actions.ts")),
      (handlers) => handler(handlers)(input),
    );
}

export function galleryServerPlugin(options: { readonly fetch?: SourceFetch } = {}): Plugin {
  const send: SourceFetch =
    options.fetch ?? ((url, init) => fetch(url, { ...init, headers: { ...init.headers } }));
  const actions: ExtensionAction[] = [
    { ...gallerySearchDef, effect: loaded(({ searchEffect }) => searchEffect(send)) },
    { ...gallerySaveDef, effect: loaded(({ saveEffect }) => saveEffect(send)) },
    { ...galleryCaptureDef, effect: loaded(({ captureEffect }) => captureEffect(send)) },
    { ...galleryStarterDef, effect: loaded(({ starterEffect }) => starterEffect) },
  ];
  return definePlugin({
    name: galleryExtension.name,
    tags: familyTags(galleryExtension),
    namespace: extensionNamespace(galleryExtension.name),
    apply: (ctx) =>
      Effect.all(
        [
          ctx.plugin(galleryPlugin()),
          Effect.forEach(actions, (action) => ctx.contribute(ActionPoint, provideAction(action)), {
            discard: true,
          }),
        ],
        { discard: true },
      ),
  });
}
