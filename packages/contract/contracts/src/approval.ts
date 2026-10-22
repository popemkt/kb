import { Context } from "effect";
import { z } from "zod";
import type { Actor } from "@kb/model";
import {
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
   * Whether the wire relays calls others make: the page's, which carries the
   * person's gestures, the agent it hosts, WebMCP's tools and the scripts it
   * runs, and kb's own in process. A call relayed from another wire in this
   * process (an {@link ActionInvocation}) keeps who made it; one that
   * carries a script's reach is the script's. Any other call on any wire is
   * made by the wire's own actor.
   */
  readonly relays?: true;
}

/**
 * Whether a call on `wire` carries `what` it states: a person's approval,
 * where the wire carries approval, and a script's reach, where it relays
 * calls others make. What a wire does not carry is dropped, never refused.
 */
function carries(wire: SurfaceWire, what: "approved" | "script"): boolean {
  return what === "approved" ? wire.carriesApproval : wire.relays === true;
}

/**
 * Who made `call`, when it was already made on a wire in this process (an
 * {@link ActionInvocation}); undefined for a bare request, which says no one.
 */
export function madeBy(call: ActionRequest | ActionInvocation): Actor | undefined {
  return "actor" in call ? call.actor : undefined;
}

/**
 * The invocation as it reaches the invoke core from `wire`: made by the
 * wire's actor or, on a wire that relays, by whoever made the call it
 * relays (`relays`), and carrying only what the wire carries
 * (`carries`). Every surface hands the core its calls through this.
 */
export function onWire(
  wire: SurfaceWire,
  request: ActionRequest | ActionInvocation,
): ActionInvocation {
  const relayed = wire.relays === true ? madeBy(request) : undefined;
  const { approved, script, ...call } = request;
  const scripted = script !== undefined && carries(wire, "script");
  return {
    ...call,
    ...(approved !== undefined && carries(wire, "approved") ? { approved } : {}),
    ...(scripted ? { script } : {}),
    actor: scripted ? "script" : (relayed ?? wire.actor),
  };
}

/**
 * Whether sandboxed code made the call: one that carried a script's reach
 * onto a wire that relays it (`onWire`), one made on the sandbox's own wire,
 * or one made while such a call runs (`callWithin`). The one actor kb holds
 * to anything by its name: such a call is held to its run's grant
 * (DESIGN.md → Sandbox → Grants), and never starts a script run.
 */
export function madeByScript(invocation: ActionInvocation): boolean {
  return invocation.actor === "script";
}

/**
 * The page's wire: what the UI sends, in the person's browser, when the
 * server knows it is the person's (DESIGN.md → Surfaces → Who the person
 * is). It relays the calls the page makes for others in its own process (the
 * agent sidebar's, WebMCP's, the scripts it hosts); a call that names none
 * is the person's gesture. A page the server vouches for nobody behind
 * calls on a local program's wire, and its gestures run there unrefused.
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
 * call, its interceptors and guards as well as its handler, so an action
 * that answers by its caller (`kb.manifest` lists what is decided for that
 * caller) reads it here rather than from its input, the commit asks the
 * guards again with what the call writes, and a call any of them makes
 * nests in this one. Code that runs outside any invocation sees `null`.
 */
export const CurrentCall = Context.Reference<RunningCall | null>("kb/CurrentCall", {
  defaultValue: () => null,
});
