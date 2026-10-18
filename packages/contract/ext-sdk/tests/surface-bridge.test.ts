import { describe, expect, test } from "bun:test";
import type { ActionMode, EXTENSION_SDK, ExtensionDeclaration } from "@kb/contracts";
import type { FailureCode } from "@kb/model";
import type { Plugin } from "@kb/plugin";
import type * as Surface from "../src/surface.ts";

/**
 * The SDK surface is self-contained so it can be emitted as a standalone
 * ambient module, which makes it a restatement of the contracts'. This is
 * the bridge that keeps the restatement exact: each binding compiles only
 * while the two sides agree, so a type changed on one side fails `tsc`
 * until the other follows.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const modes: Same<Surface.ActionMode, ActionMode> = true;
const codes: Same<Surface.FailureCode, FailureCode> = true;
/**
 * What an author writes is what kb reads: every SDK declaration is a
 * contracts declaration, and every SDK plugin a plugin the kernel loads.
 */
const declarations: [Surface.ExtensionDeclaration] extends [ExtensionDeclaration] ? true : false =
  true;
const plugins: [Surface.Plugin] extends [Plugin] ? true : false = true;
/**
 * The module's values are the host's (`EXTENSION_SDK`), and the surface
 * declares each of them, no more and no fewer, with a type the host's
 * value has. A contribution is the exception that proves it: it flows
 * from the author to the host, so for a point, and for a value that makes
 * a contribution, what is held is that what the author contributes is what
 * the host reads.
 */
type Declared = typeof Surface;
type Served = typeof EXTENSION_SDK;
type PointNames = {
  [K in keyof Declared]: Declared[K] extends Surface.PointKey<unknown> ? K : never;
}[keyof Declared];
type Contributed<P> = P extends { readonly "~type"?: infer C } ? Exclude<C, undefined> : never;
type Providers = "provideAction" | "provideTemplate";
const names: Same<keyof Declared, keyof Served> = true;
const values: [Omit<Served, PointNames | Providers>] extends [
  Omit<Declared, PointNames | Providers>,
]
  ? true
  : false = true;
const points: false extends {
  [K in PointNames]: [Contributed<Declared[K]>] extends [Contributed<Served[K]>] ? true : false;
}[PointNames]
  ? false
  : true = true;
const providers: false extends {
  [K in Providers]: [Parameters<Declared[K]>] extends [Parameters<Served[K]>] ? true : false;
}[Providers]
  ? false
  : true = true;

describe("extension SDK surface", () => {
  test("restates the contracts' mode and failure vocabularies exactly", () => {
    expect([modes, codes]).toEqual([true, true]);
  });

  test("declares an extension and its plugin in shapes the contracts read", () => {
    expect([declarations, plugins]).toEqual([true, true]);
  });

  test("declares exactly the values the host serves as kb-ext-sdk", () => {
    expect([names, values, points, providers]).toEqual([true, true, true, true]);
  });
});
