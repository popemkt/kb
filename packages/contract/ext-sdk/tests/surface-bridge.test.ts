import { describe, expect, test } from "bun:test";
import type { ActionMode, EXTENSION_SDK, ExtensionDeclaration } from "@kb/contracts";
import type { FailureCode, Knob, SeedBackdrop } from "@kb/model";
import type { Plugin } from "@kb/plugin";
import type * as Surface from "../src/surface.ts";

/**
 * The SDK surface is self-contained so it can be emitted as a standalone
 * ambient module, which makes it a restatement of the contracts'. This is
 * the bridge that keeps the restatement exact: each binding compiles only
 * while the two sides agree, so a type changed on one side fails `tsc`
 * until the other follows.
 */
/** A function, or a component class: code, whose arguments may be projections. */
type Fn = ((...args: never[]) => unknown) | (abstract new (...args: never[]) => unknown);
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/**
 * The two types are one: each is the other's, and they have the same
 * members at every level of data, down to code. Each being the other's is
 * not enough, since a type without an optional member and one with it are
 * each assignable to the other.
 */
type Same<A, B> =
  Mutual<A, B> extends true
    ? [A] extends [Fn]
      ? true
      : [A] extends [object]
        ? Mutual<keyof A, keyof B> extends true
          ? false extends { [K in keyof A & keyof B]: Same<A[K], B[K]> }[keyof A & keyof B]
            ? false
            : true
          : false
        : true
    : false;
/**
 * Every member `D` declares, at every level of data down to code, is one
 * `S` has: a surface may declare a part of a contribution, never a member
 * the host does not read, which assignability alone lets through when it
 * is optional.
 */
type Declares<D, S> = [D] extends [Fn]
  ? true
  : [D] extends [object]
    ? [keyof D] extends [keyof S]
      ? false extends { [K in keyof D & keyof S]: Declares<D[K], S[K]> }[keyof D & keyof S]
        ? false
        : true
      : false
    : true;

const modes: Same<Surface.ActionMode, ActionMode> = true;
const codes: Same<Surface.FailureCode, FailureCode> = true;
/** A backdrop's key and its knobs, as an author declares them, are the model's own. */
const knobs: Same<Surface.Knob, Knob> = true;
const backdrops: Same<Surface.SeedBackdrop, SeedBackdrop> = true;
/** The witness that it holds: a host that dropped optional metadata the surface still advertises fails. */
const dropsCredit: Same<Surface.SeedBackdrop, Omit<SeedBackdrop, "credit">> = false;
/**
 * What an author writes is what kb reads: every SDK declaration is a
 * contracts declaration, and every SDK plugin a plugin the kernel loads.
 */
const declarations: [Surface.ExtensionDeclaration] extends [ExtensionDeclaration] ? true : false =
  true;
const plugins: [Surface.Plugin] extends [Plugin] ? true : false = true;
/**
 * The module's values are the host's (`EXTENSION_SDK`), and the surface
 * declares each of them, no more and no fewer, exactly: the host can
 * neither drop nor change what the surface still advertises. What is not
 * exact is named, with why (`Projected`). A contribution flows from the
 * author to the host, so for a point and a provider what is held is that
 * what the author contributes is what the host reads, and that its data
 * names no member the host does not read (`Declares`).
 */
type Declared = typeof Surface;
type Served = typeof EXTENSION_SDK;
type PointNames = {
  [K in keyof Declared]: Declared[K] extends Surface.PointKey<unknown> ? K : never;
}[keyof Declared];
type Contributed<P> = P extends { readonly "~type"?: infer C } ? Exclude<C, undefined> : never;
/** A contribution's data: every member but its functions, whose arguments may be projections. */
type DataOf<T> = { [K in keyof T as NonNullable<T[K]> extends Fn ? never : K]: T[K] };
type AllTrue<T extends Record<PropertyKey, boolean>> = false extends T[keyof T] ? false : true;
type Providers = "provideAction" | "provideTemplate";
/**
 * The values the surface states as a projection, held one way: the two
 * interception helpers take the surface's `PluginContext`, a part of the
 * kernel's, and `NoParams` is declared as the decoder it is, not as the
 * schema class that implements it.
 */
type Projected = "guardAction" | "onAction" | "NoParams";
const names: Same<keyof Declared, keyof Served> = true;
const values: AllTrue<{
  [K in Exclude<keyof Declared, PointNames | Providers | Projected>]: Same<Served[K], Declared[K]>;
}> = true;
const projected: AllTrue<{ [K in Projected]: [Served[K]] extends [Declared[K]] ? true : false }> =
  true;
const points: AllTrue<{
  [K in PointNames]: [Contributed<Declared[K]>] extends [Contributed<Served[K]>] ? true : false;
}> = true;
const pointData: AllTrue<{
  [K in PointNames]: Declares<DataOf<Contributed<Declared[K]>>, DataOf<Contributed<Served[K]>>>;
}> = true;
const providers: AllTrue<{
  [K in Providers]: [Parameters<Declared[K]>] extends [Parameters<Served[K]>]
    ? [ReturnType<Declared[K]>] extends [ReturnType<Served[K]>]
      ? true
      : false
    : false;
}> = true;

describe("extension SDK surface", () => {
  test("restates the contracts' mode and failure vocabularies exactly", () => {
    expect([modes, codes]).toEqual([true, true]);
  });

  test("declares an extension and its plugin in shapes the contracts read", () => {
    expect([declarations, plugins]).toEqual([true, true]);
  });

  test("declares a backdrop and its knobs in the model's shapes", () => {
    expect([knobs, backdrops, dropsCredit]).toEqual([true, true, false]);
  });

  test("declares exactly the values the host serves as kb-ext-sdk, and its contributions' data", () => {
    expect([names, values, projected, points, pointData, providers]).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});
