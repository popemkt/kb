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
 * does not. A point's contribution flows from the author to the page, so
 * what is held is that what an author contributes is what the page reads;
 * a provider's arguments the same way; any other value flows from the page
 * to the author, so the page's value is one the author's type describes.
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
/** What the page serves under `K`; `served` below holds that it serves every name declared. */
type Served<K> = K extends keyof Page ? Page[K] : never;

const served: [keyof Declared] extends [keyof Page] ? true : false = true;
const points: AllTrue<{
  [K in PointNames]: [Contributed<Declared[K]>] extends [Contributed<Served<K>>] ? true : false;
}> = true;
const providers: AllTrue<{
  [K in ProviderNames]: Declared[K] extends (...args: infer A) => unknown
    ? Served<K> extends (...args: infer B) => unknown
      ? [A] extends [B]
        ? true
        : false
      : false
    : false;
}> = true;
const values: AllTrue<{
  [K in ValueNames]: [Served<K>] extends [Declared[K]] ? true : false;
}> = true;

describe("the page SDK surface", () => {
  it("declares only what the page serves, in shapes the page reads", () => {
    expect([served, points, providers, values]).toEqual([true, true, true, true]);
  });
});
