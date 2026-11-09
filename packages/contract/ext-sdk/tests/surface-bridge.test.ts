import { describe, expect, test } from "bun:test";
import type {
  TxChange,
  ReactionHost,
  TxMatch,
  ActionMode,
  EXTENSION_SDK,
  ExtensionDeclaration,
} from "@kb/contracts";
import type {
  Actor,
  BackdropVariant,
  FailureCode,
  Knob,
  NumberKnob,
  SeedBackdrop,
} from "@kb/model";
import type {
  Plugin,
  PointSpec,
  KernelHost,
  KernelSpec,
  ServiceSpec,
  RolePolicy,
} from "@kb/plugin";
import type * as Bridge from "../src/bridge.ts";
import type * as Surface from "../src/surface.ts";

/**
 * The SDK surface is self-contained so it can be emitted as a standalone
 * ambient module, which makes it a restatement of the contracts'. This is
 * the bridge that keeps the restatement exact: each binding compiles only
 * while the two sides agree, so a type changed on one side fails `tsc`
 * until the other follows (`bridge.ts` says how the two are compared).
 */
type AllTrue<T extends Record<PropertyKey, boolean>> = Bridge.AllTrue<T>;
type Same<A, B> = Bridge.Same<A, B>;
type Declares<D, S> = Bridge.Declares<D, S>;
type DataOf<T> = Bridge.DataOf<T>;
type Contributed<P> = Bridge.Contributed<P>;

const spec: Same<Surface.PointSpec, PointSpec> = true;
const host: Same<Surface.KernelHost, KernelHost> = true;
const roleSpecs: [
  Same<Surface.KernelSpec, KernelSpec>,
  Same<Surface.ServiceSpec, ServiceSpec>,
  Same<Surface.RolePolicy, RolePolicy>,
] = [true, true, true];
void roleSpecs;
void spec;
void host;
const reactions: [
  Same<Surface.TxChange, TxChange>,
  Same<Surface.ReactionHost, ReactionHost>,
  Same<Surface.TxMatch, TxMatch>,
] = [true, true, true];
void reactions;
const actor: Same<Surface.Actor, Actor> = true;
void actor;
const modes: Same<Surface.ActionMode, ActionMode> = true;
const codes: Same<Surface.FailureCode, FailureCode> = true;
/** A backdrop's key and its knobs, as an author declares them, are the model's own. */
const knobs: Same<Surface.Knob, Knob> = true;
const backdrops: Same<Surface.SeedBackdrop, SeedBackdrop> = true;
/**
 * The witnesses that it holds: a host that dropped optional metadata the
 * surface still advertises fails, at the top, inside an optional member,
 * and in one variant of a union.
 */
const dropsCredit: Same<Surface.SeedBackdrop, Omit<SeedBackdrop, "credit">> = false;
const dropsVariantStrength: Same<
  Surface.SeedBackdrop,
  Omit<SeedBackdrop, "variants"> & {
    readonly variants?: readonly Omit<BackdropVariant, "strength">[];
  }
> = false;
const dropsUnit: Same<Surface.Knob, Exclude<Knob, NumberKnob> | Omit<NumberKnob, "unit">> = false;
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
 * exact is named, with why (`Projected`, `Library`). A contribution flows from the
 * author to the host, so for a point and a provider what is held is that
 * what the author contributes is what the host reads, and that its data
 * names no member the host does not read (`Declares`).
 */
type Declared = typeof Surface;
type Served = typeof EXTENSION_SDK;
type PointNames = {
  [K in keyof Declared]: Declared[K] extends Surface.PointKey<unknown> ? K : never;
}[keyof Declared];
type Providers = "provideAction" | "provideTemplate";
/**
 * The values the surface states as a projection, held one way: the two
 * interception helpers take the surface's `PluginContext`, a part of the
 * kernel's, and `NoParams` is declared as the decoder it is, not as the
 * schema class that implements it.
 */
type Projected = "guardAction" | "onAction" | "NoParams";
/**
 * The library the module re-exports as it is (`effect`'s `Effect` and
 * `Schema`): its shape is the library's on both sides, not kb's to
 * restate, and too wide to walk member by member, so it is held as the
 * same library by assignability.
 */
type Library = "Effect" | "Schema";
const names: Same<keyof Declared, keyof Served> = true;
const values: AllTrue<{
  [K in Exclude<keyof Declared, PointNames | Providers | Projected | Library>]: Same<
    Served[K],
    Declared[K]
  >;
}> = true;
const projected: AllTrue<{ [K in Projected]: [Served[K]] extends [Declared[K]] ? true : false }> =
  true;
const library: AllTrue<{
  [K in Library]: [Served[K]] extends [Declared[K]]
    ? [Declared[K]] extends [Served[K]]
      ? true
      : false
    : false;
}> = true;
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
    expect([knobs, backdrops]).toEqual([true, true]);
    expect([dropsCredit, dropsVariantStrength, dropsUnit]).toEqual([false, false, false]);
  });

  test("declares exactly the values the host serves as kb-ext-sdk, and its contributions' data", () => {
    expect([names, values, projected, library, points, pointData, providers]).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});
