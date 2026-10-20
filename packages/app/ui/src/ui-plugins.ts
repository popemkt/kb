/**
 * The plugins the UI ships with, and which of them the page loads. The shell
 * starts them before it renders; each owns its pages and sidebar section, and
 * nothing in the shell names any of them again.
 *
 * The page holds a resolver, not a second list (DESIGN-UI.md → Extension UI
 * halves): the core plugins are always loaded, and a family's browser entry
 * is loaded exactly when the server reports that family loaded, in
 * `kb.manifest`. Whether an optional family is on is the server's decision,
 * so the page's switch for it asks the server (`extension.switch`) and then
 * follows the report. Until a server answers, the page is its own server: it
 * reads the one bundled list as a store with no switch written. Every plugin
 * reaches the kernel through `syncUiPlugins`.
 *
 * Each bundled family's browser entry comes from its `-ui` package; a
 * repository extension's is its closure's page half, which the server
 * serves at the path its row names, imported beside them.
 */
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as zod from "zod";
import { ulid } from "ulid";
import { Effect } from "effect";
import { AGENT_CHANNEL, agentExtension } from "@kb/agent";
import type { AgentPorts, Standing } from "@kb/agent-ui";
import { backdropsExtension } from "@kb/backdrops";
import { backdropsUiPlugin } from "@kb/backdrops-ui";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { canvasExtension } from "@kb/canvas";
import { chartExtension } from "@kb/chart";
import { locationsExtension } from "@kb/locations";
import { checkExtension } from "@kb/check";
import { themesExtension } from "@kb/themes";
import { themesUiPlugin } from "@kb/themes-ui";
import { codeExtension } from "@kb/code";
import { collectionsExtension } from "@kb/collections";
import { collectionsUiPlugin } from "@kb/collections-ui";
import {
  EXTENSION_SDK,
  NO_SWITCHES,
  declarationPlugin,
  extensionRow,
  familyOn,
  installHostModules,
  type ExtensionRow,
} from "@kb/contracts";
import { docsExtension } from "@kb/docs";
import { governanceExtension, governancePlugin } from "@kb/governance";
import { graphExtension } from "@kb/graph";
import { graphUiPlugin } from "@kb/graph-ui";
import { labExtension } from "@kb/lab";
import { locationsUiPlugin } from "@kb/locations-ui";
import { outlineExtension } from "@kb/outline";
import { extensionNodeId } from "@kb/model";
import { outlineUiPlugin } from "@kb/outline-ui";
import { coreExtension } from "@kb/operations";
import { isPlugin, PluginError, type Plugin } from "@kb/plugin";
import { getLiveClient } from "@/api/live";
import { browserHostUiPlugin } from "@/browser-host";
import { designSystemsUiPlugin } from "@/design-systems";
import { canvasUiPlugin } from "@kb/canvas-ui";
import { chartUiPlugin } from "@kb/chart-ui";
import { codeUiPlugin } from "@kb/code-ui";
import { layoutUiPlugin } from "@/components/layout/plugin";
import { ontologyUiPlugin } from "@/components/ontology/plugin";
import { extensionsUiPlugin } from "@/components/prefs/extensions-plugin";
import * as uiSdk from "@kb/ui-sdk";
import { logWarn, syncUiPlugins } from "@kb/ui-sdk";
import { loadManifest, servedManifest, subscribeManifest } from "@/lib/manifest";
import { screenUiPlugin } from "@/screen";
import { invokeSettled } from "@/session/runtime";
import { shownNodes, useGraphStore } from "@/stores/graph.store";
import { useUiStore } from "@/stores/ui.store";
import { webMcpUiPlugin } from "@/webmcp";

// GAP [[01M549THN6RH36SEE9QTSZ0PZP]] the shell's page plugins belong to no family
/**
 * Always loaded: the shell's own projections. Core's views reach the page
 * kernel's catalog through the same declaration the server loads them from.
 */
export const CORE_UI_PLUGINS: readonly Plugin[] = [
  declarationPlugin(coreExtension),
  browserHostUiPlugin,
  designSystemsUiPlugin,
  ontologyUiPlugin,
  extensionsUiPlugin,
  layoutUiPlugin,
  webMcpUiPlugin,
  screenUiPlugin,
];

/**
 * Where this tab's connection stands, from the socket's state and what the
 * server said of it: whose it is is told once per connection, after it opens.
 */
function standingOf({
  wsStatus,
  person,
}: Pick<ReturnType<typeof useUiStore.getState>, "wsStatus" | "person">): Standing {
  if (wsStatus !== "open") return "offline";
  if (person === undefined) return "unknown";
  return person === null ? "nobody" : "person";
}

/**
 * The agent's ports, bound to this page: the live socket's `agent.chat`
 * channel, the socket's state, and the browser's one invoke path, through
 * which the person's approve or decline is made. The agent's UI half reaches
 * neither the socket nor the invoke path itself.
 */
const AGENT_PORTS: AgentPorts = {
  listen: (sink) => getLiveClient().listen(AGENT_CHANNEL, sink),
  send: (request) => getLiveClient().sendChannel(AGENT_CHANNEL, request),
  connection: (listener) => {
    let told = standingOf(useUiStore.getState());
    return useUiStore.subscribe((next) => {
      const standing = standingOf(next);
      if (standing === told) return;
      told = standing;
      listener(standing);
    });
  },
  // A local write answers at once and is pushed after; the agent is told
  // what the server made of the call, never the optimistic first answer.
  invoke: async (invocation) => (await invokeSettled(invocation)).settled,
  newConversation: () => ulid(),
};

/** The agent's browser entry, bound to the page's ports once, the first time it loads. */
let agentEntry: Plugin | undefined;
async function loadAgentEntry(): Promise<Plugin> {
  const { agentUiPlugin } = await import("@kb/agent-ui");
  agentEntry ??= agentUiPlugin(AGENT_PORTS);
  return agentEntry;
}

/** How the page loads a family's browser entry. */
export interface BrowserExtension {
  readonly load: () => Promise<Plugin>;
}

/**
 * The browser entry of each family, keyed by the name its declaration gives
 * it. Whether the page loads one is the server's report, never this table.
 * How it is fetched is: a family a store always has on (the outline) or has
 * on by default (collections, graph, canvas, code, chart, locations, backdrops, themes) loads
 * from the main bundle, and one off by default (the lab) or hosted only by
 * `kb ui` (the agent) is its own chunk, fetched when it is first on. A family with no
 * browser half is listed too, as `null`, so a bundled family is never left
 * out by omission: the resolver's test holds every bundled family to an entry.
 */
export const BROWSER_EXTENSIONS: Readonly<Record<string, BrowserExtension | null>> = {
  [governanceExtension.name]: { load: () => Promise.resolve(governancePlugin) },
  [outlineExtension.name]: { load: () => Promise.resolve(outlineUiPlugin) },
  [collectionsExtension.name]: { load: () => Promise.resolve(collectionsUiPlugin) },
  [graphExtension.name]: { load: () => Promise.resolve(graphUiPlugin) },
  [docsExtension.name]: null,
  [canvasExtension.name]: { load: () => Promise.resolve(canvasUiPlugin) },
  [labExtension.name]: {
    load: () => import("@kb/lab-ui").then(({ labUiPlugin }) => labUiPlugin),
  },
  [checkExtension.name]: null,
  [codeExtension.name]: { load: () => Promise.resolve(codeUiPlugin) },
  [chartExtension.name]: { load: () => Promise.resolve(chartUiPlugin) },
  [locationsExtension.name]: { load: () => Promise.resolve(locationsUiPlugin) },
  [backdropsExtension.name]: { load: () => Promise.resolve(backdropsUiPlugin) },
  [themesExtension.name]: { load: () => Promise.resolve(themesUiPlugin) },
  [agentExtension.name]: { load: loadAgentEntry },
};

/**
 * The bundled families as the page reads them while no server answers: a
 * server over a store with no switch written, so an optional family is as
 * its declaration has it by default.
 * It hosts nothing, so it reports no agent.
 */
// GAP [[01M53M9XA8FN8Q25QJVFF8MBE4]] the page's offline family list reads only the bundled families
const OWN_EXTENSIONS: readonly ExtensionRow[] = BUNDLED_FAMILIES.map((declaration) =>
  extensionRow(declaration, "bundled", familyOn(declaration, NO_SWITCHES, logWarn)),
);

/** The extensions the page follows: the server's report, else its own reading. */
function followedExtensions(): readonly ExtensionRow[] {
  return servedManifest()?.extensions ?? OWN_EXTENSIONS;
}

/**
 * The families whose browser entry the page loads, in the order reported:
 * each one reported loaded that the page has an entry for. A family the
 * server did not load, or does not report, has no UI on the page.
 */
export function familiesToLoad(rows: readonly ExtensionRow[]): readonly string[] {
  return loadable(rows).map((row) => row.name);
}

/** The rows of {@link familiesToLoad}. */
function loadable(rows: readonly ExtensionRow[]): readonly ExtensionRow[] {
  return rows.filter((row) => row.enabled && browserEntry(row) !== null);
}

/**
 * The browser entry the page has for a family: a bundled family's from the
 * resolver, a repository extension's from the path its row names; null when
 * the family has no browser half.
 */
function browserEntry(row: ExtensionRow): BrowserExtension | null {
  if (Object.hasOwn(BROWSER_EXTENSIONS, row.name)) return BROWSER_EXTENSIONS[row.name] ?? null;
  const { page } = row;
  return page === undefined ? null : { load: () => importPageHalf(page) };
}

/**
 * The page's own modules, which a repository extension's page half reads
 * rather than carries (`HOST_MODULES`): kb's SDK and the page's host API
 * as the page's own objects, and its one React.
 */
function installPageModules(): void {
  installHostModules("page", {
    "kb-ext-sdk": EXTENSION_SDK,
    "kb-ext-sdk/page": uiSdk,
    zod,
    "zod/v4": zod,
    react: React,
    "react/jsx-runtime": jsxRuntime,
  });
}

/**
 * A repository extension's page half, imported from `path`: the bytes of
 * the closure a person trusted, which run in the page with the page's
 * power (DESIGN.md → Core boundary & extensions → repository extensions).
 */
async function importPageHalf(path: string): Promise<Plugin> {
  installPageModules();
  const module: unknown = await import(/* @vite-ignore */ path);
  const entry =
    typeof module === "object" && module !== null && "default" in module
      ? module.default
      : undefined;
  if (isPlugin(entry)) return entry;
  throw new Error(`its page half at ${path} default-exports no plugin`);
}

/**
 * The failed entries handed to the kernel, one per family, path and reason:
 * a failure read again for the same reason is the same value, so the kernel
 * is left as it is and nothing is toasted twice.
 */
const unloadables = new Map<string, Plugin>();

/**
 * A family's browser entry the page could not have: a plugin of the
 * family's name whose `apply` fails with why, so the kernel holds the
 * failure as it holds any plugin's, and every reader of the kernel (the
 * Extensions panel's `organisationOf`, its log) sees it.
 */
function unloadable(key: string, name: string, why: string): Plugin {
  const known = unloadables.get(`${key}\0${why}`);
  if (known !== undefined) return known;
  const plugin: Plugin = {
    name,
    apply: () =>
      Effect.fail(new PluginError({ plugin: name, reason: "apply-failed", message: why })),
  };
  unloadables.set(`${key}\0${why}`, plugin);
  return plugin;
}

/**
 * Each family's browser entry that resolved, once per place it is served
 * from: the same row answers the same plugin value, so a converged kernel
 * is left as it is, and a page half served from new bytes (a new path)
 * resolves anew and replaces it (`syncPlugins`). A failure is not kept:
 * it is tried again at the next convergence, so one that was passing (a
 * chunk the network dropped) recovers without a reload.
 */
const resolved = new Map<string, Plugin>();

/** Load one family's browser entry, held to the name it was resolved by. */
async function loadEntry(row: ExtensionRow): Promise<Plugin | null> {
  const { name } = row;
  const key = `${name}\0${row.page ?? ""}`;
  const known = resolved.get(key);
  if (known !== undefined) return known;
  const extension = browserEntry(row);
  if (extension === null) return null;
  try {
    const plugin = await extension.load();
    if (plugin.name !== name) {
      return unloadable(key, name, `its browser entry is named ${plugin.name}`);
    }
    resolved.set(key, plugin);
    return plugin;
  } catch (error) {
    return unloadable(key, name, `its browser entry failed to load: ${String(error)}`);
  }
}

let generation = 0;
/** The latest convergence, done once the kernel holds what it was started for. */
let settling: Promise<void> = Promise.resolve();

/**
 * Converge the kernel on the core plugins plus the entries for `rows`. The
 * entries load first, so the kernel moves once; a newer convergence that
 * starts meanwhile wins, and this one is dropped.
 */
async function converge(rows: readonly ExtensionRow[]): Promise<void> {
  const mine = ++generation;
  const entries = await Promise.all(loadable(rows).map(loadEntry));
  if (mine !== generation) return;
  syncUiPlugins([...CORE_UI_PLUGINS, ...entries.filter((entry) => entry !== null)]);
}

/**
 * Where the page's graph has the switch node of each optional family it
 * follows now: its version, joined.
 */
function switchVersions(): string {
  const nodes = shownNodes();
  return followedExtensions()
    .filter((row) => row.optional)
    .map((row) => nodes.get(extensionNodeId(row.name))?.updatedAt ?? "")
    .join("\n");
}

/**
 * Done once the kernel holds the plugins for the extensions the page follows
 * now: the latest convergence, and any started while it ran.
 */
export async function extensionsSettled(): Promise<void> {
  const current = settling;
  await current;
  if (current !== settling) await extensionsSettled();
}

/**
 * Load the UI's plugins, then keep the kernel in step with the server's
 * report: a family the report drops is unloaded, and its pages and sidebar
 * section leave with it, without a reload. A switch written anywhere (another
 * tab, the CLI) reaches this page's graph, and the page reads the server's
 * report again. Returns the unsubscribe.
 */
export function startUiPlugins(): () => void {
  const sync = () => {
    settling = converge(followedExtensions());
  };
  sync();
  const unsubscribeManifest = subscribeManifest(sync);
  let switches = switchVersions();
  const unsubscribeGraph = useGraphStore.subscribe(() => {
    const next = switchVersions();
    if (next === switches) return;
    switches = next;
    if (servedManifest() !== null) void loadManifest();
  });
  return () => {
    unsubscribeManifest();
    unsubscribeGraph();
  };
}
