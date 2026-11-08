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
import { Cause, Effect, Predicate, Result, Schema } from "effect";
import type { FunctionComponent } from "react";
import { BACKDROP_DIRECTIONS, BACKDROP_STRENGTHS, KnobSchema } from "@kb/model";
import type { Contribution } from "@kb/plugin";
import {
  BACKDROP_CUE_LABELS,
  type Backdrop,
  type BackdropCue,
  type BackdropProps,
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

/** React's own tags for the components that are objects: `memo`, `forwardRef` and `lazy`. */
const EXOTIC: ReadonlySet<unknown> = new Set([
  Symbol.for("react.memo"),
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
]);

/** Anything React draws as a component: a function, or one of its exotic wrappers. */
const Component = Schema.declare(
  (value: unknown): value is FunctionComponent<BackdropProps> =>
    Predicate.isFunction(value) ||
    (Predicate.hasProperty(value, "$$typeof") && EXOTIC.has(value.$$typeof)),
  { expected: "a component (a function, memo or forwardRef)" },
);

/** A cue the label table names: the table is where the cues are stated. */
const Cue = Schema.declare(
  (value: unknown): value is BackdropCue =>
    Predicate.isString(value) && Object.hasOwn(BACKDROP_CUE_LABELS, value),
  { expected: `one of ${Object.keys(BACKDROP_CUE_LABELS).join(", ")}` },
);

const OneLine = Schema.String.check(
  Schema.makeFilter((does: string) =>
    does.trim() !== "" && !/[\r\n]/.test(does) ? undefined : "must say what it does in one line",
  ),
);

const Strength = Schema.Literals(BACKDROP_STRENGTHS);

const Variant = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  schemes: Schema.optionalKey(Schema.Array(Schema.Literals(["dark", "light"]))),
  strength: Schema.optionalKey(Strength),
  knobs: Schema.optionalKey(Schema.Array(KnobSchema)),
});

/**
 * A backdrop's contribution, as the contract states it (`Backdrop`): every
 * field a reader reads, its key's with them, and `interactions` none where
 * it gave none. What it does not name is carried as it came.
 */
const BackdropData = Schema.Struct({
  key: Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    credit: Schema.optionalKey(Schema.String),
    strength: Schema.optionalKey(Strength),
    knobs: Schema.optionalKey(Schema.Array(KnobSchema)),
    variants: Schema.optionalKey(Schema.Array(Variant)),
  }),
  presentation: Schema.Struct({
    space: Schema.Finite,
    height: Schema.Finite,
    offset: Schema.Finite,
    span: Schema.Union([
      Schema.Struct({ reach: Schema.Literal("content"), maxWidth: Schema.Finite }),
      Schema.Struct({ reach: Schema.Literal("region") }),
    ]),
    directions: Schema.Array(Schema.Literals(BACKDROP_DIRECTIONS)),
    opacity: Schema.Struct({ subtle: Schema.Finite, soft: Schema.Finite, vivid: Schema.Finite }),
  }),
  budget: Schema.Struct({ frameMs: Schema.Finite.check(Schema.isGreaterThan(0)) }),
  interactions: Schema.Array(Schema.Struct({ cue: Cue, does: OneLine })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  Component,
});

const decodeData = Schema.decodeUnknownResult(BackdropData, { onExcessProperty: "preserve" });

/** One line, for a card: a `Schema` issue is an indented tree. */
function oneLine(message: string): string {
  return [...new Set(message.split("\n").map((line) => line.trim()))]
    .filter((line) => line.length > 0)
    .join(" ");
}

/**
 * What `error` says, without trusting it to say it safely: what a getter
 * threw reaches here inside the decoder's own error, its cause.
 */
function said(error: unknown): string {
  try {
    const cause = error instanceof Error ? error.cause : undefined;
    const thrown = Cause.isCause(cause) ? Cause.squash(cause) : error;
    return thrown instanceof Error ? thrown.message : String(thrown);
  } catch {
    return "an error that cannot be shown";
  }
}

/**
 * Read one contribution's value as a backdrop, or say why the page will
 * not draw it. The value is a page half's, so reading it may run its code
 * (a getter): whatever that throws refuses it too, and what is read is a
 * copy, so nothing of it runs again when a reader reads it.
 */
export function decodeBackdrop(value: unknown): DecodedBackdrop {
  try {
    const read = decodeData(value);
    if (Result.isFailure(read)) return { ok: false, why: oneLine(read.failure.message) };
    const backdrop: Backdrop = read.success;
    return { ok: true, backdrop };
  } catch (error) {
    return { ok: false, why: `reading it threw: ${said(error)}` };
  }
}

/** The name a refused contribution gave itself, if reading it is safe and it gave one. */
function labelOf(value: unknown): string | null {
  try {
    const key = Predicate.hasProperty(value, "key") ? value.key : undefined;
    const label = Predicate.hasProperty(key, "label") ? key.label : undefined;
    return Predicate.isString(label) ? label : null;
  } catch {
    return null;
  }
}

/**
 * Each contribution read, by the kernel's own object for it: the kernel
 * hands a new list whenever any plugin moves, and a contribution read once
 * is the same value every time after, so what draws it (a head's scene)
 * sees nothing new.
 */
const read = new WeakMap<Contribution<Backdrop>, Contribution<Backdrop> | RefusedBackdrop>();

function readOne(contribution: Contribution<Backdrop>): Contribution<Backdrop> | RefusedBackdrop {
  const decoded = decodeBackdrop(contribution.value);
  if (decoded.ok) return { ...contribution, value: decoded.backdrop };
  const { id, owner } = contribution;
  return { id, owner, label: labelOf(contribution.value), why: decoded.why };
}

/** Every contribution `BackdropPoint` holds, read (`decodeBackdrop`), each once. */
export function readBackdrops(
  contributions: readonly Contribution<Backdrop>[],
): ContributedBackdrops {
  const shown: Contribution<Backdrop>[] = [];
  const refused: RefusedBackdrop[] = [];
  for (const contribution of contributions) {
    const known = read.get(contribution) ?? readOne(contribution);
    read.set(contribution, known);
    if ("why" in known) refused.push(known);
    else shown.push(known);
  }
  return { shown, refused };
}
