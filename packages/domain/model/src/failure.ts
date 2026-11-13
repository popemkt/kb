import { z } from "zod";

/**
 * The domain's failure vocabulary. Every receipt code, every DomainError and
 * every ResolveError code is drawn from it, so it lives with the model rather
 * than with the action contracts that report it. It is written out as a type
 * first, the form the extension SDK declares it in, and its schema is held to
 * it.
 */
export type FailureCode =
  | "not_found"
  | "invalid_input"
  | "ambiguous"
  | "conflict"
  | "invalid_move"
  | "forbidden"
  | "internal"
  | "unknown_action"
  // The action requires a person's approval and the call carried none; the
  // same call with `approved: true` on its envelope may succeed.
  | "approval_required";

/**
 * Each code as its own value: the mapped type refuses a code it lacks, one it
 * adds, and a value that is not its key, so the schema reads exactly
 * {@link FailureCode}.
 */
const FAILURE_CODES = {
  not_found: "not_found",
  invalid_input: "invalid_input",
  ambiguous: "ambiguous",
  conflict: "conflict",
  invalid_move: "invalid_move",
  forbidden: "forbidden",
  internal: "internal",
  unknown_action: "unknown_action",
  approval_required: "approval_required",
} as const satisfies { readonly [Code in FailureCode]: Code };

export const FailureCodeSchema = z.enum(FAILURE_CODES);

/**
 * An error that names its own {@link FailureCode}. This is the shape every
 * surface can turn into a receipt without guessing — `receiptFromError` reads
 * exactly these two fields, and `ensureDomainError` folds anything else into
 * `internal`. {@link DomainError} is one; a bundled extension's own error class
 * is another.
 */
export interface CodedError extends Error {
  readonly code: FailureCode;
  readonly details?: unknown;
}
