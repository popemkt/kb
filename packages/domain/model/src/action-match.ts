/**
 * Which actions a `match` names: the one grammar for saying "these calls",
 * read by everything that answers for a set of actions — the interception
 * points' listeners (`@kb/contracts` → interception) and the approval
 * policies alike. An action id names that action; a pattern with `*` (any
 * run of characters) names every id it matches; a mode word names every
 * action of that mode.
 */

/**
 * The words `match` takes for a mode instead of an action: every action of
 * that mode. An action id has no space, so neither can be mistaken for one.
 */
export const MODE_MATCHES = { "every read": "read", "every write": "write" } as const;

/**
 * How specifically `match` names an action, or `null` when it does not name
 * it. Compared as a tuple, most specific first: the action's own id, then a
 * pattern by how many literal characters it holds, then a mode word, then a
 * pattern of nothing but `*`.
 */
export function matchSpecificity(
  match: string,
  action: { readonly id: string; readonly mode: { readonly kind: "read" | "write" } },
): readonly [number, number] | null {
  if (match === action.id) return [4, match.length];
  const mode = Object.entries(MODE_MATCHES).find(([words]) => words === match)?.[1];
  if (mode !== undefined) return mode === action.mode.kind ? [2, 0] : null;
  if (!match.includes("*")) return null;
  const pattern = match
    .split("*")
    .map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  if (!new RegExp(`^${pattern}$`).test(action.id)) return null;
  const literal = match.replaceAll("*", "").length;
  return literal > 0 ? [3, literal] : [1, 0];
}
