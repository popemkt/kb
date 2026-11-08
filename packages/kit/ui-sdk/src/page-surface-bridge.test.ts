import { describe, expect, it } from "vitest";
import type { PageSurface, Surface } from "@kb/ext-sdk";
import type * as UiSdk from "./index";

/**
 * `kb-ext-sdk/page` is this module as the page serves it to a repository
 * extension's page half (`installHostModules`), and `page-surface.ts` is
 * its types restated for an author, self-contained so they can be emitted
 * as a standalone ambient module. This is the bridge that keeps the
 * restatement exact, as `surface-bridge.test.ts` keeps `kb-ext-sdk`'s:
 * each binding compiles only while the two sides agree, so a type changed
 * on one side fails `tsc` until the other follows.
 *
 * The surface declares a part of what the page serves, never a value it
 * does not. A value it declares is the page's own, exactly: the page can
 * neither drop nor change what the surface advertises. A contribution's
 * data may be declared in part, but never with a member the page does not
 * read (`Declares`). Code is held one way, since its arguments may be a
 * projection (`BackdropProps.node` is a node's id, not the page's row):
 * what an author contributes, and a provider's arguments and result, are
 * what the page reads.
 */
type Declared = typeof PageSurface;
type Page = typeof UiSdk;
type PointNames = {
  [K in keyof Declared]: Declared[K] extends Surface.PointKey<unknown> ? K : never;
}[keyof Declared];
type ProviderNames = Extract<keyof Declared, `provide${string}`>;
type ValueNames = Exclude<keyof Declared, PointNames | ProviderNames>;
type Contributed<P> = P extends { readonly "~type"?: infer C } ? Exclude<C, undefined> : never;
type AllTrue<T extends Record<PropertyKey, boolean>> = false extends T[keyof T] ? false : true;
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
/** A contribution's data: every member but its functions. */
type DataOf<T> = { [K in keyof T as NonNullable<T[K]> extends Fn ? never : K]: T[K] };
/** What the page serves under `K`; `served` below holds that it serves every name declared. */
type Served<K> = K extends keyof Page ? Page[K] : never;

const served: [keyof Declared] extends [keyof Page] ? true : false = true;
const points: AllTrue<{
  [K in PointNames]: [Contributed<Declared[K]>] extends [Contributed<Served<K>>] ? true : false;
}> = true;
const pointData: AllTrue<{
  [K in PointNames]: Declares<DataOf<Contributed<Declared[K]>>, DataOf<Contributed<Served<K>>>>;
}> = true;
const providers: AllTrue<{
  [K in ProviderNames]: Declared[K] extends (...args: infer A) => infer R
    ? Served<K> extends (...args: infer B) => infer S
      ? [A] extends [B]
        ? [R] extends [S]
          ? true
          : false
        : false
      : false
    : false;
}> = true;
const values: AllTrue<{ [K in ValueNames]: Same<Served<K>, Declared[K]> }> = true;
/** The witness that it holds: a page whose backdrop dropped a member the surface still declares fails. */
const dropsBudget: Declares<
  DataOf<Contributed<Declared["BackdropPoint"]>>,
  Omit<DataOf<Contributed<Page["BackdropPoint"]>>, "budget">
> = false;

describe("the page SDK surface", () => {
  it("declares only what the page serves, exactly, in shapes the page reads", () => {
    expect([served, points, pointData, providers, values, dropsBudget]).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});
