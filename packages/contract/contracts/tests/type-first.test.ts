/**
 * The types the extension SDK restates are written out first, and each
 * schema is held to its type both ways. `satisfies z.ZodType<T>` in the
 * source refuses a value the type does not allow; these refuse a value the
 * type allows and the schema does not read, as a member the schema lacks or
 * a choice it narrows. Each binding compiles only while the two agree.
 */
import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import type { ActionMode, ActionModeSchema } from "../src/actions.ts";
import type { TxMatch, TxMatchSchema } from "../src/tx-match.ts";

/** Each is assignable to the other. */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** The same members, of the same types. */
type SameObject<A, B> = Mutual<A, B> extends true ? Mutual<keyof A, keyof B> : false;
/** The same kinds, and each kind's arm the same object. */
type SameUnion<A extends { kind: string }, B extends { kind: string }> =
  Mutual<A["kind"], B["kind"]> extends true
    ? false extends {
        [K in A["kind"]]: SameObject<Extract<A, { kind: K }>, Extract<B, { kind: K }>>;
      }[A["kind"]]
      ? false
      : true
    : false;

describe("type-first schemas", () => {
  test("an action mode's schema reads exactly the written type", () => {
    const exact: SameUnion<z.output<typeof ActionModeSchema>, ActionMode> = true;
    expect(exact).toBe(true);
  });

  test("a transaction match's schema reads exactly the written type", () => {
    const exact: SameObject<z.output<typeof TxMatchSchema>, TxMatch> = true;
    expect(exact).toBe(true);
  });
});
