import { coreNative, type RegisteredAction } from "./invoke.ts";
import { isomorphicActions } from "./isomorphic-actions.ts";
import { assetUploadDef, assetUploadEffect } from "./assets.ts";
import {
  sandboxImportLegacyDef,
  sandboxImportLegacyEffect,
  sandboxTrustDef,
  sandboxTrustEffect,
  sandboxTrustedDef,
  sandboxTrustedEffect,
  sandboxUntrustDef,
  sandboxUntrustEffect,
} from "./trust.ts";
import { graphRunDef, graphRunEffect } from "./actions.ts";
import {
  extensionFootprintDef,
  extensionFootprintEffect,
  extensionListDef,
  extensionListEffect,
  extensionSettingsDef,
  extensionSettingsEffect,
  extensionSwitchDef,
  extensionSwitchEffect,
} from "./extensions.ts";
import { kbManifestDef, kbManifestEffect } from "./manifest.ts";
import { viewsMigrateDef, viewsMigrateEffect } from "./views-migrate.ts";
import {
  renderViewActionEffect,
  renderViewDef,
  renderViewsActionEffect,
  renderViewsDef,
} from "./render.ts";
import {
  uiCaptureDef,
  uiCaptureEffect,
  uiNavigateDef,
  uiNavigateEffect,
  uiScreenDef,
  uiScreenEffect,
  uiSelectDef,
  uiSelectEffect,
} from "./ui.ts";

/**
 * The actions that reach a service only the invoke tip's composition root can
 * provide: a workspace port (saved queries, views, assets, code trust), the registry's
 * own catalogs (actions, views, extensions), or the screens of the UI tabs.
 */
const portActions: readonly RegisteredAction[] = [
  coreNative(graphRunDef, graphRunEffect),
  coreNative(assetUploadDef, assetUploadEffect),
  coreNative(renderViewDef, renderViewActionEffect),
  coreNative(renderViewsDef, renderViewsActionEffect),
  coreNative(kbManifestDef, kbManifestEffect),
  coreNative(extensionSwitchDef, extensionSwitchEffect),
  coreNative(extensionFootprintDef, extensionFootprintEffect),
  coreNative(extensionListDef, extensionListEffect),
  coreNative(extensionSettingsDef, extensionSettingsEffect),
  coreNative(viewsMigrateDef, viewsMigrateEffect),
  coreNative(uiScreenDef, uiScreenEffect),
  coreNative(uiNavigateDef, uiNavigateEffect),
  coreNative(uiSelectDef, uiSelectEffect),
  coreNative(uiCaptureDef, uiCaptureEffect),
  coreNative(sandboxTrustDef, sandboxTrustEffect),
  coreNative(sandboxImportLegacyDef, sandboxImportLegacyEffect),
  coreNative(sandboxUntrustDef, sandboxUntrustEffect),
  coreNative(sandboxTrustedDef, sandboxTrustedEffect),
];

export const coreActions: readonly RegisteredAction[] = [...isomorphicActions, ...portActions];
