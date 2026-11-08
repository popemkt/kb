import { describe, expect, it } from "vitest";
import type { Bridge, PageSurface, Surface } from "@kb/ext-sdk";
import type * as UiSdk from "./index";
import type { PAGE_EXTENSION_SDK } from "./page-extension-sdk";

/**
 * `kb-ext-sdk/page` is PAGE_EXTENSION_SDK, served to a repository
 * extension's page half (`installHostModules`), and `page-surface.ts` is
 * its types restated for an author, self-contained so they can be emitted
 * as a standalone ambient module. This is the bridge that keeps the
 * restatement exact, as `surface-bridge.test.ts` keeps `kb-ext-sdk`'s:
 * each binding compiles only while the two sides agree, so a type changed
 * on one side fails `tsc` until the other follows (`@kb/ext-sdk`'s
 * `bridge.ts` says how the two are compared).
 *
 * The surface declares exactly the values the page serves. A value it declares is the page's own, exactly: the page can
 * neither drop nor change what the surface advertises. A contribution's
 * data may be declared in part, but never with a member the page does not
 * read (`Declares`). Code is held one way, since its arguments may be a
 * projection (`BackdropProps.node` is a node's id, not the page's row):
 * what an author contributes, and a provider's arguments and result, are
 * what the page reads.
 */
type Declared = typeof PageSurface;
type Page = typeof PAGE_EXTENSION_SDK;
type PointNames = {
  [K in keyof Declared]: Declared[K] extends Surface.PointKey<unknown> ? K : never;
}[keyof Declared];
type ProviderNames = Extract<keyof Declared, `provide${string}`>;
type ValueNames = Exclude<keyof Declared, PointNames | ProviderNames>;
type AllTrue<T extends Record<PropertyKey, boolean>> = Bridge.AllTrue<T>;
type Same<A, B> = Bridge.Same<A, B>;
type Declares<D, S> = Bridge.Declares<D, S>;
type DataOf<T> = Bridge.DataOf<T>;
type Contributed<P> = Bridge.Contributed<P>;
/** What the page serves under `K`; `served` below holds that it serves every name declared. */
type Served<K> = K extends keyof Page ? Page[K] : never;

const served: Same<keyof Declared, keyof Page> = true;
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

/**
 * What a backdrop says it answers is held exactly, not as a contribution
 * is: a contribution may declare a part, so a cue the surface dropped from
 * `BackdropCue` would still be one the page reads, and an author would
 * lose it with nothing red. The witness: a surface missing a cue fails.
 */
const cues: Same<UiSdk.BackdropCue, PageSurface.BackdropCue> = true;
const interactions: Same<UiSdk.BackdropInteraction, PageSurface.BackdropInteraction> = true;
const dropsACue: Same<UiSdk.BackdropCue, Exclude<PageSurface.BackdropCue, "navigation">> = false;

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

  it("names the cues a backdrop answers exactly as the page does", () => {
    expect([cues, interactions, dropsACue]).toEqual([true, true, false]);
  });
});
