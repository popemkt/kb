/**
 * The gallery family's server entry (DESIGN.md → Extension families): the
 * family's shared plugin, and its actions with their handlers,
 * `ext.gallery.search`, `ext.gallery.save`, `ext.gallery.capture` and
 * `ext.gallery.starter`. `fetch` is the platform's
 * unless a test hands it a fake source.
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
import { captureEffect, saveEffect, searchEffect, starterEffect } from "./actions.ts";
import type { SourceFetch } from "./http.ts";

export function galleryServerPlugin(options: { readonly fetch?: SourceFetch } = {}): Plugin {
  const send: SourceFetch =
    options.fetch ?? ((url, init) => fetch(url, { ...init, headers: { ...init.headers } }));
  const actions: ExtensionAction[] = [
    { ...gallerySearchDef, effect: searchEffect(send) },
    { ...gallerySaveDef, effect: saveEffect(send) },
    { ...galleryCaptureDef, effect: captureEffect(send) },
    { ...galleryStarterDef, effect: starterEffect },
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
