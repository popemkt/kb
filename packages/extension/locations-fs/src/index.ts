/**
 * The locations family's server entry (DESIGN.md → Locations): its actions
 * with their handlers, `ext.locations.*` with `location.*` aliases.
 */
import { Effect } from "effect";
import {
  ActionPoint,
  extensionNamespace,
  provideAction,
  type ExtensionAction,
  familyTags,
} from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import {
  locationForgetDef,
  locationListDef,
  locationOpenDef,
  locationRegisterDef,
  locationsExtension,
} from "@kb/locations";
import {
  locationForgetEffect,
  locationListEffect,
  locationOpenEffect,
  locationRegisterEffect,
} from "./actions.ts";

const actions: ExtensionAction[] = [
  { ...locationListDef, effect: locationListEffect },
  { ...locationRegisterDef, effect: locationRegisterEffect },
  { ...locationForgetDef, effect: locationForgetEffect },
  { ...locationOpenDef, effect: locationOpenEffect },
];

export const locationsPlugin = definePlugin({
  name: locationsExtension.name,
  tags: familyTags(locationsExtension),
  namespace: extensionNamespace(locationsExtension.name),
  apply: (ctx) =>
    Effect.forEach(actions, (action) => ctx.contribute(ActionPoint, provideAction(action)), {
      discard: true,
    }),
});
