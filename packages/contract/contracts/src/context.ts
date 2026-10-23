import { Context } from "effect";
import { z } from "zod";
import { schemaToJsonSchema } from "@kb/model";
import { Point, type Contribution } from "@kb/plugin";
import type { ActionDefinition } from "./actions.ts";
import type { PaneScreen } from "./screen.ts";

/**
 * A context reference: what "this" means on the pane a person works in
 * (DESIGN.md → Action registry → What a session fills). An action declares
 * which of its required inputs a call made in a tab session may take from
 * one (`ActionDefinition.context`), and the invoke core resolves it against
 * the session's active pane before the call runs.
 *
 * References are contributed, not a core enum: a pane's state only a family
 * understands (a canvas's open document, its item ids) is resolved by that
 * family, so a selection is never read as node ids in one view and item ids
 * in another.
 */
export interface ContextReference {
  /** What it is on a pane, as the manifest lists it and a refusal names it ("the focused node"). */
  readonly description: string;
  /** What `pane` holds under it, or `undefined` when it holds none: nothing is invented. */
  readonly resolve: (pane: PaneScreen) => unknown;
}

/** Where a family's declaration contributes its references (`ExtensionDeclaration.context`). */
export const ContextReferencePoint = Point<ContextReference>()("kb.context");

/**
 * Core's references, which every pane reports (`PaneScreen`), in the root
 * namespace. Core's declaration carries them, as a family's carries its own.
 */
export const CORE_CONTEXT_REFERENCES: Readonly<Record<string, ContextReference>> = {
  focused: {
    description: "the node the pane's focus is on",
    resolve: (pane) => pane.focused ?? undefined,
  },
  subject: {
    description: "the node the pane's view is shown for",
    resolve: (pane) => pane.view?.subject,
  },
};

/** The references a host's calls can be filled from, by id. */
export interface ContextReferences {
  readonly of: (id: string) => ContextReference | undefined;
}

/**
 * The references a kernel's plugins contribute to
 * {@link ContextReferencePoint}, read anew on each lookup so a family that
 * loads or goes is seen at once.
 */
export function contextReferencesOf(
  contributions: () => readonly Contribution<ContextReference>[],
): ContextReferences {
  return { of: (id) => contributions().find((contribution) => contribution.id === id)?.value };
}

/** No references: a host with no kernel fills nothing. */
export const NO_CONTEXT: ContextReferences = { of: () => undefined };

/** Where the invoke core reads the references its host's plugins contribute: none unless a host provides them. */
export const CurrentContextReferences = Context.Reference<ContextReferences>(
  "kb/CurrentContextReferences",
  { defaultValue: () => NO_CONTEXT },
);

const RequiredKeysSchema = z.object({ required: z.array(z.string()).optional() });

/**
 * Why a definition's `context` cannot be registered, or `null` when it can:
 * each key it fills must be one its input requires, so a call that works
 * without a session means the same with one (a key whose absence already
 * means something, like `node.add`'s `parent`, is never filled), and each
 * reference must be one a plugin contributes.
 */
export function contextRefusal(
  def: ActionDefinition,
  references: ContextReferences,
): string | null {
  const declared = Object.entries(def.context ?? {});
  if (declared.length === 0) return null;
  const parsed = RequiredKeysSchema.safeParse(schemaToJsonSchema(def.inputSchema, "input"));
  const required = new Set(parsed.success ? (parsed.data.required ?? []) : []);
  for (const [key, reference] of declared) {
    if (!required.has(key)) {
      return `action ${def.id} has a session fill ${key}, which its input does not require; only a required input can be filled`;
    }
    if (references.of(reference) === undefined) {
      return `action ${def.id} fills ${key} from ${reference}, which no loaded plugin contributes`;
    }
  }
  return null;
}
