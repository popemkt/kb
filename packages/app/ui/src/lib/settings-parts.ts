/**
 * Where each part of the Settings page is (DESIGN-UI.md → Settings): the
 * part is the path, so a part can be linked to and history moves between
 * parts. The paths the page had before it was in parts lead to the part
 * that holds what they showed, and the page replaces them with that part's
 * own path.
 */
import { SETTINGS_PATH } from "@kb/ui-sdk";
import { SETTINGS_PARTS, type SettingsPart } from "@kb/views";

/** How the rail names each part, and the line under the part's title. */
export const PART_WORDS: Readonly<Record<SettingsPart, { label: string; lede: string }>> = {
  general: {
    label: "General",
    lede: "This device's layout, and any setting of this kb no other part holds.",
  },
  appearance: {
    label: "Appearance",
    lede: "How every page of this kb looks and moves, and this device's light or dark.",
  },
  extensions: {
    label: "Extensions",
    lede: "Each extension's switch, its settings and what it composes. Off, its actions, views and MCP tools leave, on every tab.",
  },
  advanced: {
    label: "Advanced",
    lede: "The listeners asked in turn, the repository extensions refused, and the same settings from the CLI.",
  },
};

/** The paths the page had before it was in parts, and the part each now is. */
const FORMER_PATHS: Readonly<Record<string, SettingsPart>> = {
  "/extensions": "extensions",
  "/preferences": "appearance",
};

/** The path of `part`: `/settings` for the first, `/settings/<part>` for the rest. */
export function settingsPath(part: SettingsPart): string {
  return part === SETTINGS_PARTS[0] ? SETTINGS_PATH : `${SETTINGS_PATH}/${part}`;
}

/** The part `path` opens, a former path's included, or null where it opens none. */
export function settingsPartOf(path: string): SettingsPart | null {
  const bare = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (bare === SETTINGS_PATH) return SETTINGS_PARTS[0];
  const named = bare.startsWith(`${SETTINGS_PATH}/`) ? bare.slice(SETTINGS_PATH.length + 1) : null;
  const part = SETTINGS_PARTS.find((candidate) => candidate === named);
  return part ?? FORMER_PATHS[bare] ?? null;
}
