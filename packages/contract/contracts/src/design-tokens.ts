import { Point } from "@kb/plugin";
import { CORE_POINT_DEFINITIONS } from "./point-definitions.ts";
/**
 * The colour tokens a renderer reads (DESIGN-UI.md → Design tokens): the
 * contract between a design system's stylesheet, which defines each, and
 * every painter that paints with one, in the browser or on the server. Each
 * comes with the colour it stands for when there is no document to resolve
 * it against (unit tests, SSR, a server painter). The fallback belongs to
 * the token, not to whichever caller reads it; `css-color.test.ts` (`app/ui`)
 * binds each to the stylesheets.
 */
const TOKEN_FALLBACK = {
  "--foreground": "#222",
  "--background": "#fff",
  "--card": "#fff",
  "--muted": "#f5f5f5",
  "--muted-foreground": "#737373",
  "--primary": "#c27c0e",
  // The warm light of a sun on a light page (a backdrop's day light).
  "--header-sun": "#f7c948",
  "--border": "#e5e5e5",
  "--popover": "#fff",
  "--popover-foreground": "#222",
  "--destructive": "#dc2626",
  "--graph-edge": "rgba(34, 34, 34, 0.4)",
} as const;

export type ColorToken = `--${string}`;

/** Core-owned fallbacks; families supply their pure maps beside these. */
export const COLOR_TOKEN_FALLBACKS: Readonly<Partial<Record<ColorToken, string>>> = TOKEN_FALLBACK;

/** Pure token lookup port, also usable by server renderers without a host. */
export interface ColorTokenReader {
  readonly fallback: (token: ColorToken) => string;
}

/** Compose declarations once; identical repetitions are harmless, conflicts are refused. */
export function colorTokenReader(
  sources: readonly Readonly<Partial<Record<ColorToken, string>>>[],
): ColorTokenReader {
  const tokens = new Map<string, string>();
  for (const source of sources)
    for (const [name, value] of Object.entries(source)) {
      if (value === undefined) continue;
      const known = tokens.get(name);
      if (known !== undefined && known !== value)
        throw new Error(`conflicting colour token ${name}`);
      tokens.set(name, value);
    }
  return {
    fallback: (name) => {
      const value = tokens.get(name);
      if (value === undefined) throw new Error(`undeclared colour token ${name}`);
      return value;
    },
  };
}

/** Loaded declarations offer fallback data without adding it to the wire catalog. */
export const ColorTokenPoint = Point<Readonly<Record<ColorToken, string>>>()(
  CORE_POINT_DEFINITIONS.colorTokens.name,
  CORE_POINT_DEFINITIONS.colorTokens.spec,
);
