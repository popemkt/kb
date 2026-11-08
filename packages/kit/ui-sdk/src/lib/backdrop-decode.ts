/**
 * A backdrop as the page reads it from `BackdropPoint` (DESIGN-UI.md →
 * Page-head backdrops → Read once, checked): the kernel holds what a page
 * half contributed as it typed it, and a repository extension's page half
 * is third-party code built against whichever SDK it was, so the page
 * checks each contribution before anything draws it. A list it left out
 * that the contract has since required is filled with its empty value
 * (`interactions`, none); anything else that is not what the contract
 * says refuses that one backdrop, with why, and leaves every other alone.
 * kb's own pass through the same check: one reading for every backdrop.
 * The page's other points do not check what they hold yet:
 * GAP [[01M6XKP09V8E144HJBXMBV0MFK]].
 */
import { BACKDROP_DIRECTIONS, BACKDROP_STRENGTHS } from "@kb/model";
import type { Contribution } from "@kb/plugin";
import {
  BACKDROP_CUE_LABELS,
  type Backdrop,
  type BackdropCue,
  type BackdropInteraction,
} from "./plugins";

/** One contribution read: the backdrop to draw, or why it is refused. */
export type DecodedBackdrop =
  | { readonly ok: true; readonly backdrop: Backdrop }
  | { readonly ok: false; readonly why: string };

/** A contribution the page will not draw: which, whose, its name if it said one, and why. */
export interface RefusedBackdrop {
  readonly id: string;
  readonly owner: string;
  readonly label: string | null;
  readonly why: string;
}

/** What `BackdropPoint` holds, read: the backdrops the page draws, and those it refused. */
export interface ContributedBackdrops {
  readonly shown: readonly Contribution<Backdrop>[];
  readonly refused: readonly RefusedBackdrop[];
}

type Fields = Readonly<Record<string, unknown>>;

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  options.some((option) => option === value);

const isCue = (value: unknown): value is BackdropCue =>
  typeof value === "string" && Object.hasOwn(BACKDROP_CUE_LABELS, value);

/** Why `value` is not a presentation, or null when it is one. */
function presentationFault(value: unknown): string | null {
  if (!isFields(value)) return "its presentation is not an object";
  const { space, height, offset, span, directions, opacity } = value;
  if (!isNumber(space) || !isNumber(height) || !isNumber(offset))
    return "its presentation's space, height and offset must be numbers";
  if (
    !isFields(span) ||
    !(span["reach"] === "region" || (span["reach"] === "content" && isNumber(span["maxWidth"])))
  )
    return "its presentation's span must reach the content (with a maxWidth) or the region";
  if (!Array.isArray(directions) || !directions.every((d) => isOneOf(BACKDROP_DIRECTIONS, d)))
    return `its presentation's directions must be a list of ${BACKDROP_DIRECTIONS.join(", ")}`;
  if (!isFields(opacity) || !BACKDROP_STRENGTHS.every((strength) => isNumber(opacity[strength])))
    return `its presentation's opacity must give a number for ${BACKDROP_STRENGTHS.join(", ")}`;
  return null;
}

/** `value` as a backdrop's interactions (none where it gave none), or why it is not. */
function interactionsOf(value: unknown): readonly BackdropInteraction[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return "its interactions are not a list";
  const read: BackdropInteraction[] = [];
  for (const item of value) {
    if (!isFields(item)) return "an interaction is not an object";
    const { cue, does } = item;
    if (!isCue(cue))
      return `an interaction's cue ${JSON.stringify(cue)} is not one of ${Object.keys(BACKDROP_CUE_LABELS).join(", ")}`;
    if (typeof does !== "string" || does.trim() === "" || /[\r\n]/.test(does))
      return `its ${cue} interaction must say what it does in one line`;
    read.push({ cue, does });
  }
  return read;
}

const refuse = (why: string): DecodedBackdrop => ({ ok: false, why });

/** Read one contribution's value as a backdrop, or say why the page will not draw it. */
export function decodeBackdrop(value: unknown): DecodedBackdrop {
  if (!isFields(value)) return refuse("it is not an object");
  const { key, presentation, budget, interactions, Component } = value;
  if (!isFields(key) || typeof key["id"] !== "string" || typeof key["label"] !== "string")
    return refuse("its key has no id and label");
  const fault = presentationFault(presentation);
  if (fault !== null) return refuse(fault);
  if (!isFields(budget) || !isNumber(budget["frameMs"]) || budget["frameMs"] <= 0)
    return refuse("its budget's frameMs must be a positive number");
  if (typeof Component !== "function") return refuse("its Component is not a component");
  const read = interactionsOf(interactions);
  if (typeof read === "string") return refuse(read);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field the contract names was checked above; the rest is carried as contributed
  const checked = value as unknown as Backdrop;
  return { ok: true, backdrop: { ...checked, interactions: read } };
}

/** Every contribution `BackdropPoint` holds, read (`decodeBackdrop`). */
export function readBackdrops(
  contributions: readonly Contribution<Backdrop>[],
): ContributedBackdrops {
  const shown: Contribution<Backdrop>[] = [];
  const refused: RefusedBackdrop[] = [];
  for (const contribution of contributions) {
    const read = decodeBackdrop(contribution.value);
    if (read.ok) {
      shown.push({ ...contribution, value: read.backdrop });
      continue;
    }
    const value: unknown = contribution.value;
    const key = isFields(value) ? value["key"] : undefined;
    const label = isFields(key) && typeof key["label"] === "string" ? key["label"] : null;
    refused.push({ id: contribution.id, owner: contribution.owner, label, why: read.why });
  }
  return { shown, refused };
}
