import { Effect, Predicate } from "effect";
import type { StandardSchemaV1, StandardJSONSchemaV1 } from "effect/StandardSchema";
import { z } from "zod";
import { type DomainError, domainFromResolve, isDomainError } from "./errors.ts";
import { ResolveError } from "./resolve.ts";

/**
 * Standard Schema v1 compatibility seam for action input/output schemas.
 * Zod 4 already implements `~standard`; Effect Schema can via
 * `Schema.toStandardSchemaV1`. A schema can also publish Standard JSON Schema
 * converters, so validation and manifest metadata come from the same definition.
 */

export type StandardSchemaV1Issue = StandardSchemaV1.Issue;
export type StandardSchemaV1Like<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;

interface ParsableSchema {
  readonly parse: (input: unknown) => unknown;
}

/** Accept Standard Schema v1 or any object exposing `.parse` (zod). */
export type ActionSchema = StandardSchemaV1Like | ParsableSchema;

export function isStandardSchemaV1(schema: unknown): schema is StandardSchemaV1Like {
  if (!Predicate.hasProperty(schema, "~standard")) return false;
  const standard = schema["~standard"];
  return (
    Predicate.isObject(standard) &&
    standard.version === 1 &&
    typeof standard.validate === "function"
  );
}

function isParsableSchema(schema: unknown): schema is ParsableSchema {
  return Predicate.hasProperty(schema, "parse") && typeof schema.parse === "function";
}

export function isActionSchema(schema: unknown): schema is ActionSchema {
  return isStandardSchemaV1(schema) || isParsableSchema(schema);
}

export class ActionSchemaError extends Error {
  override readonly name = "ActionSchemaError";
  readonly issues: ReadonlyArray<StandardSchemaV1Issue>;

  constructor(message: string, issues: ReadonlyArray<StandardSchemaV1Issue>) {
    super(message);
    this.issues = issues;
  }
}

/** A thrown zod failure, recognised structurally so zod stays one import. */
export function isZodError(err: unknown): err is Error & { issues: unknown } {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError";
}

/** Name a schema failure: the one mapping from a thrown value to a typed one. */
export function schemaFailure(err: unknown): ActionSchemaError | DomainError {
  if (err instanceof ActionSchemaError) return err;
  if (isZodError(err)) return new ActionSchemaError(err.message, [{ message: err.message }]);
  if (err instanceof ResolveError) return domainFromResolve(err);
  if (isDomainError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ActionSchemaError(message, [{ message }]);
}

/**
 * Parse a value through an action schema — Standard Schema v1 when present,
 * else `.parse`. Fails with the typed {@link schemaFailure} of whatever the
 * schema raised.
 *
 * One parser for both ends of an action: an input on the way in and a result
 * on the way out are the same operation against the same kind of schema. What
 * differs is whose fault a mismatch is, and that is the caller's to name.
 */
export const parseBySchema = Effect.fn("kb.parseBySchema")(function* (
  schema: ActionSchema,
  input: unknown,
): Effect.fn.Return<unknown, ActionSchemaError | DomainError> {
  if (isStandardSchemaV1(schema)) {
    const result = yield* Effect.promise(() =>
      Promise.resolve(schema["~standard"].validate(input)),
    );
    if (result.issues !== undefined) {
      return yield* Effect.fail(
        new ActionSchemaError(result.issues.map((i) => i.message).join("; "), result.issues),
      );
    }
    return result.value;
  }
  return yield* Effect.try({ try: () => schema.parse(input), catch: schemaFailure });
});

/**
 * Which side of a schema a JSON Schema describes. A schema with defaults or
 * transforms accepts one shape and produces another: an action's input is
 * published as what a caller may send, its output as what it returns.
 */
type SchemaSide = "input" | "output";

/** JSON Schema for manifests: the schema's own converter, zod's adapter, else a permissive object. */
export function schemaToJsonSchema(schema: ActionSchema, side: SchemaSide): unknown {
  if (exportsJsonSchema(schema))
    return schema["~standard"].jsonSchema[side]({ target: "draft-2020-12" });
  if (isZodType(schema)) {
    return z.toJSONSchema(schema, { io: side });
  }
  return { type: "object" };
}

function isZodType(schema: unknown): schema is z.ZodType {
  return (
    isStandardSchemaV1(schema) && schema["~standard"].vendor === "zod" && isParsableSchema(schema)
  );
}

function exportsJsonSchema(schema: ActionSchema): schema is ActionSchema & StandardJSONSchemaV1 {
  if (!isStandardSchemaV1(schema)) return false;
  const standard = schema["~standard"];
  return (
    Predicate.hasProperty(standard, "jsonSchema") &&
    Predicate.hasProperty(standard.jsonSchema, "input") &&
    Predicate.hasProperty(standard.jsonSchema, "output") &&
    Predicate.isFunction(standard.jsonSchema.input) &&
    Predicate.isFunction(standard.jsonSchema.output)
  );
}
