/**
 * How a restated surface is held to what the host serves (DESIGN.md →
 * Extension SDK): the comparisons `surface-bridge.test.ts` holds
 * `kb-ext-sdk` by, and `@kb/ui-sdk`'s `page-surface-bridge.test.ts`
 * holds `kb-ext-sdk/page` by. Types only, compiled by `tsc`: a binding
 * typed `true` compiles only while the two sides agree.
 *
 * Assignability alone is not enough. A type without an optional member
 * and one with it are each assignable to the other, and a union's `keyof`
 * names only the members every variant has, so a member dropped from one
 * variant, or from an optional object, would pass. These compare every
 * variant's members, at every level of data, through optional members,
 * down to code.
 *
 * Import it as a namespace (`import type * as Bridge`): a named import of
 * these recursive aliases sends the checker (tsgo 7.0.2) into a check
 * that runs for minutes, where the namespace form takes a second.
 */

/** A function, or a class such as a component: code, whose arguments may be projections. */
export type Fn = ((...args: never[]) => unknown) | (abstract new (...args: never[]) => unknown);

/** Each assignable to the other. */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** The one type, as the checker sees it: nothing left to look inside (a library's namespace on both sides). */
type Identical<A, B> =
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- T is the probe the identity check compares through, used once by design
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Every member any variant of `T` has. */
type KeysOf<T> = T extends unknown ? keyof T : never;

/** What any variant of `T` holds at `K`, defined: an optional member is compared by what it holds when present. */
type At<T, K extends PropertyKey> = T extends unknown
  ? K extends keyof T
    ? Exclude<T[K], undefined>
    : never
  : never;

/** Whether every one of `T`'s values is true. */
export type AllTrue<T extends Record<PropertyKey, boolean>> = false extends T[keyof T]
  ? false
  : true;

/** What a list holds, compared by its element rather than by the list's own methods. */
type ElementOf<T> = Exclude<T, undefined | null> extends readonly (infer E)[] ? E : never;
type IsList<T> = [Exclude<T, undefined | null>] extends [never]
  ? false
  : [Exclude<T, undefined | null>] extends [readonly unknown[]]
    ? true
    : false;

/** Whether `T`, defined, is data to look inside: an object that is not code. */
type IsData<T> = [Exclude<T, undefined | null>] extends [never]
  ? false
  : [Exclude<T, undefined | null>] extends [Fn]
    ? false
    : [Exclude<T, undefined | null>] extends [object]
      ? true
      : false;

/**
 * The two types are one: each is the other's, and every variant of each
 * has the members the other's has, at every level of data, down to code.
 */
export type Same<A, B> =
  Identical<A, B> extends true
    ? true
    : Mutual<A, B> extends true
      ? IsList<A> extends true
        ? Same<ElementOf<A>, ElementOf<B>>
        : IsData<A> extends true
          ? Mutual<KeysOf<A>, KeysOf<B>> extends true
            ? false extends {
                [K in KeysOf<A> & KeysOf<B>]: Same<At<A, K>, At<B, K>>;
              }[KeysOf<A> & KeysOf<B>]
              ? false
              : true
            : false
          : true
      : false;

/**
 * Every member `D` declares, in any variant, at every level of data down
 * to code, is one `S` has: a surface may declare a part of a contribution,
 * never a member the host does not read.
 */
export type Declares<D, S> =
  Identical<D, S> extends true
    ? true
    : IsList<D> extends true
      ? IsList<S> extends true
        ? Declares<ElementOf<D>, ElementOf<S>>
        : false
      : IsData<D> extends true
        ? [KeysOf<D>] extends [KeysOf<S>]
          ? false extends {
              [K in KeysOf<D> & KeysOf<S>]: Declares<At<D, K>, At<S, K>>;
            }[KeysOf<D> & KeysOf<S>]
            ? false
            : true
          : false
        : true;

/** A contribution's data: every member but its code. */
export type DataOf<T> = { [K in keyof T as Exclude<T[K], undefined> extends Fn ? never : K]: T[K] };

/** What a point's contributions are, from its key. */
export type Contributed<P> = P extends { readonly "~type"?: infer C }
  ? Exclude<C, undefined>
  : never;
