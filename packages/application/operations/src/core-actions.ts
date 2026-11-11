import {
  extensionUpdateDef,
  extensionUpdateEffect,
  extensionOutdatedDef,
  extensionOutdatedEffect,
  extensionRemoveDef,
  extensionRemoveEffect,
  extensionLinkDef,
  extensionLinkEffect,
  extensionUnlinkDef,
  extensionUnlinkEffect,
  extensionGcDef,
  extensionGcEffect,
} from "./extension-lifecycle.ts";
import {
  marketplaceAddDef,
  marketplaceAddEffect,
  marketplaceRemoveDef,
  marketplaceRemoveEffect,
  marketplaceUpdateDef,
  marketplaceUpdateEffect,
  marketplaceListDef,
  marketplaceListEffect,
} from "./extension-marketplace.ts";
import { extensionDiffDef, extensionDiffEffect } from "./extension-review.ts";
import { coreNative, type RegisteredAction } from "./invoke.ts";
import { isomorphicActions } from "./isomorphic-actions.ts";
import { extensionInstallDef, extensionInstallEffect } from "./extension-install.ts";
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
  storeBackupDef,
  storeBackupEffect,
  storeBackupsDef,
  storeBackupsEffect,
  storeRestoreDef,
  storeRestoreEffect,
} from "./store-backup.ts";
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
  coreNative(extensionUpdateDef, extensionUpdateEffect),
  coreNative(extensionOutdatedDef, extensionOutdatedEffect),
  coreNative(extensionRemoveDef, extensionRemoveEffect),
  coreNative(extensionLinkDef, extensionLinkEffect),
  coreNative(extensionUnlinkDef, extensionUnlinkEffect),
  coreNative(extensionGcDef, extensionGcEffect),
  coreNative(marketplaceAddDef, marketplaceAddEffect),
  coreNative(marketplaceRemoveDef, marketplaceRemoveEffect),
  coreNative(marketplaceUpdateDef, marketplaceUpdateEffect),
  coreNative(marketplaceListDef, marketplaceListEffect),
  coreNative(graphRunDef, graphRunEffect),
  coreNative(assetUploadDef, assetUploadEffect),
  coreNative(renderViewDef, renderViewActionEffect),
  coreNative(renderViewsDef, renderViewsActionEffect),
  coreNative(kbManifestDef, kbManifestEffect),
  coreNative(extensionSwitchDef, extensionSwitchEffect),
  coreNative(extensionInstallDef, extensionInstallEffect),
  coreNative(extensionFootprintDef, extensionFootprintEffect),
  coreNative(extensionListDef, extensionListEffect),
  coreNative(extensionDiffDef, extensionDiffEffect),
  coreNative(extensionSettingsDef, extensionSettingsEffect),
  coreNative(viewsMigrateDef, viewsMigrateEffect),
  coreNative(storeBackupDef, storeBackupEffect),
  coreNative(storeBackupsDef, storeBackupsEffect),
  coreNative(storeRestoreDef, storeRestoreEffect),
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
