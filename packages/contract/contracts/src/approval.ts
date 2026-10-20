import { Context } from "effect";
import { z } from "zod";
import type { Actor } from "@kb/model";
import {
  ActionRequestSchema,
  ManifestEntrySchema,
  type ActionInvocation,
  type ActionRequest,
  type ActionMode,
  type ActionReceipt,
  type BatchPart,
} from "./actions.ts";

/**
 * Approval (DESIGN.md → Action registry → Approval): what can be decided
 * about a call, whether a person stands behind it, who makes it on each
 * wire, and what a surface needs to project the decision. Who decides is
 * the guards' (Interception); the governance family's policies are one of
 * them. Every surface reads the decision the guards give its caller to list
 * its actions.
 */

/**
 * What is decided about a call, from least to most restrictive: it runs, it
 * runs once a person approves it, or it never runs.
 */
export const APPROVAL_DECISIONS = ["allow", "ask", "deny"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/**
 * What a surface's wire format can carry, and who calls through it, declared
 * once by each surface that projects the registry (the CLI's `action-invoke`,
 * HTTP, MCP, WebMCP, the agent). The surface contract proves each declaration
 * by behaviour.
 */
export interface SurfaceWire {
  /** Whether a call on this wire has an envelope that can carry `approved`. */
  readonly carriesApproval: boolean;
  /** Who a call on this wire is made by. */
  readonly actor: Actor;
  /**
   * Whether the wire relays calls others make, each naming who makes it and,
   * for a script's call, its reach: the page's, which carries the person's
   * gestures, the agent it hosts, WebMCP's tools and the scripts it runs. A
   * call on any other wire is made by the wire's own actor.
   */
  readonly relays?: true;
}

/** What a call may state of itself beyond the action and its input. */
const STATED = ["approved", "actor", "script"] as const;
type Stated = (typeof STATED)[number];

/**
 * Whether a call on `wire` may state `what` as `request` does: that a
 * person approved it, where the wire carries approval, and who makes it and
 * a script's reach, where it relays them. The surface owns who calls, so a
 * caller can never say it is someone else, or that a person approved what
 * no person saw. Naming the actor the wire makes it anyway claims nothing,
 * so any wire takes that (a page nobody is verified for calls WebMCP's
 * tools as the agent it already is).
 */
// GAP [[01M5BVBDY7HNGXN2ZQJR4BHMPP]]
function mayState(wire: SurfaceWire, what: Stated, request: ActionRequest): boolean {
  if (what === "approved") return wire.carriesApproval;
  return wire.relays === true || (what === "actor" && request.actor === wire.actor);
}

/**
 * The invocation as it reaches the invoke core from `wire`: made by the
 * wire's actor, or, on a wire that relays, by the actor the call names,
 * and carrying only what the wire lets a call state (`mayState`). Every
 * surface hands the core its calls through this.
 */
export function onWire(wire: SurfaceWire, request: ActionRequest): ActionInvocation {
  const { approved, actor, script, ...call } = request;
  return {
    ...call,
    ...(approved !== undefined && mayState(wire, "approved", request) ? { approved } : {}),
    ...(script !== undefined && mayState(wire, "script", request) ? { script } : {}),
    actor: actor !== undefined && mayState(wire, "actor", request) ? actor : wire.actor,
  };
}

/**
 * The request `raw` makes on `wire`, a call's envelope as it arrives from
 * outside kb (an HTTP body, `kb action-invoke`'s JSON), or why it may not
 * be made: a call that states what its wire does not let it is refused, so
 * its caller hears it rather than finding it ignored.
 */
export function requestOnWire(
  wire: SurfaceWire,
  raw: unknown,
):
  | { readonly request: ActionRequest }
  | { readonly invalid: string }
  | { readonly refused: string } {
  const parsed = ActionRequestSchema.safeParse(raw);
  if (!parsed.success) return { invalid: parsed.error.issues.map((i) => i.message).join("; ") };
  const stated = STATED.filter(
    (what) => parsed.data[what] !== undefined && !mayState(wire, what, parsed.data),
  );
  if (stated.length === 0) return { request: parsed.data };
  return {
    refused: `a call here cannot state ${stated.join(" or ")}: this surface says who calls, and a person approves only through a surface they control`,
  };
}

/**
 * The page's wire: what the UI sends, in the person's browser. It relays
 * the calls the page makes for others (the agent sidebar's, WebMCP's, the
 * scripts it hosts), each naming its actor, and a call that names none is
 * the person's gesture. The server takes a call as the page's only when it
 * carries this run's page token (`page-token.ts`), which the page has from
 * the URL that opened it and nothing the server serves carries.
 */
export const PAGE_WIRE: SurfaceWire = { carriesApproval: true, actor: "human", relays: true };

/**
 * Whether a person stands behind the call: it says a person approved it, or
 * it is a person's own gesture. A human actor is the person, so a call that
 * asks is answered by the gesture itself; both are declared, not proven, and
 * whoever can claim one can claim the other.
 */
// GAP [[01M413SP3QSSQJMKKDK3W3J6G8]]
export function hasPerson(invocation: ActionInvocation): boolean {
  return invocation.approved === true || invocation.actor === "human";
}

/**
 * A node whose configuration a write sets or names, as the person asked to
 * approve it is shown it: each of its settings, with the values it holds
 * after the write.
 */
export const ShownConfigurationSchema = z.object({
  node: z.string(),
  label: z.string(),
  settings: z.array(
    z.object({ field: z.string(), label: z.string(), values: z.array(z.string()) }),
  ),
});
export type ShownConfiguration = z.infer<typeof ShownConfigurationSchema>;

/**
 * Why a call waits for a person, as a surface shows the ask: the refusal's
 * message, and for a write to configuration what it runs with.
 */
export const ApprovalAskSchema = z.object({
  message: z.string(),
  configuration: z.array(ShownConfigurationSchema).optional(),
});
export type ApprovalAsk = z.infer<typeof ApprovalAskSchema>;

const ConfigurationDetailsSchema = z.object({ configuration: z.array(ShownConfigurationSchema) });

/** The ask an `approval_required` receipt makes, read from the refusal it carries. */
export function approvalAsk(receipt: ActionReceipt): ApprovalAsk {
  if (receipt.status !== "failed") return { message: `${receipt.id} asks for approval` };
  const details = ConfigurationDetailsSchema.safeParse(receipt.details);
  return details.success
    ? { message: receipt.message, configuration: details.data.configuration }
    : { message: receipt.message };
}

/**
 * Whether a surface lists an action, given what is decided about a call to
 * it on that surface. The one rule is this: a surface leaves out an action
 * whose call could never succeed there — one that is denied, or one that
 * asks for approval on a wire that cannot carry it. A call by id still
 * reaches the invoke core, which refuses it.
 */
export function listedOn(wire: SurfaceWire, decision: ApprovalDecision): boolean {
  if (decision === "deny") return false;
  return decision === "allow" || wire.carriesApproval;
}

/**
 * One action as `kb.manifest` lists it to a caller: its manifest entry and
 * what is decided about that caller's call to it.
 */
export const DecidedEntrySchema = ManifestEntrySchema.extend({
  decision: z.enum(APPROVAL_DECISIONS),
});
export type DecidedEntry = z.infer<typeof DecidedEntrySchema>;

const ManifestActionsSchema = z.object({ actions: z.array(DecidedEntrySchema) });

/**
 * What a surface lists, from the receipt of the `kb.manifest` call it made on
 * its own wire: the actions {@link listedOn} keeps. A surface that cannot read
 * the manifest (a policy denies it, say) lists nothing, since it cannot know
 * what else it could call.
 */
export function listingOf(wire: SurfaceWire, receipt: ActionReceipt): DecidedEntry[] {
  if (receipt.status !== "succeeded") return [];
  const parsed = ManifestActionsSchema.safeParse(receipt.output);
  if (!parsed.success) return [];
  return parsed.data.actions.filter((entry) => listedOn(wire, entry.decision));
}

/** An action as a call to it is decided: its id, its mode, and a batch's parts (`approvalSubject`). */
export interface CalledAction {
  readonly id: string;
  readonly mode: ActionMode;
  /** The actions it is a batch of, each with its own mode (`batchPartsOf`). */
  readonly batchOf?: readonly BatchPart[] | undefined;
}

/** The call a handler runs as: the invocation, and the action it invokes. */
export interface RunningCall {
  readonly invocation: ActionInvocation;
  readonly action: CalledAction;
  /** How many calls deep it runs: 1 for a call a surface made, one more for each made inside another. */
  readonly depth?: number;
}

/**
 * The call a handler runs as. The invoke core provides it around each
 * handler, so an action that answers by its caller (`kb.manifest` lists what
 * is decided for that caller) reads it here rather than from its input, and
 * the commit asks the guards again with what the call writes. Code that
 * runs outside any invocation sees `null`.
 */
export const CurrentCall = Context.Reference<RunningCall | null>("kb/CurrentCall", {
  defaultValue: () => null,
});
