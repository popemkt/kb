import type { Plugin } from "@kb/plugin";
import { syncUiPlugins, paletteStepsPlugin } from "@kb/ui-sdk";
import { browserHostUiPlugin } from "@/browser-host";
import { coreUiPlugin } from "@/core-plugin";

/** What the app always loads beside its families: the host, the palette's steps, core. */
const ALWAYS: readonly Plugin[] = [browserHostUiPlugin, paletteStepsPlugin, coreUiPlugin];

/**
 * Load `plugins` into the page's UI kernel behind the shell's host and core,
 * as the app loads its plugins (`ui-plugins.ts`): the kernel converges on
 * exactly these, the host and core's page half, so a plugin that reaches the
 * page through its host applies, and a role core owns has its default. A
 * test that means the host to be absent syncs the kernel itself.
 */
export function syncPagePlugins(plugins: readonly Plugin[]): void {
  syncUiPlugins([...ALWAYS, ...plugins.filter((plugin) => !ALWAYS.includes(plugin))]);
}
