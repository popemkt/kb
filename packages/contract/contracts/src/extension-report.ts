/**
 * The extension report (`extension.list`; DESIGN.md → Plugin organisation):
 * every extension a host composes, as `kb ext list` prints it and the
 * page's Settings draws it. Each row is the catalog's row
 * ({@link ExtensionRowSchema}) with how its plugins sit among the others in
 * every kernel the host holds families in: their tags, each service they
 * inject and who provides it, what they provide, and why any of them
 * failed. Beside the rows are the points whose listeners a host asks in
 * turn, each in that order, and the repository modules discovery refused.
 * Nothing here is stored: the catalog and the kernels are the sources.
 */
import { Context } from "effect";
import { z } from "zod";
import {
  KERNEL_HOSTS,
  POINT_CARDINALITIES,
  POINT_TIERS,
  ROLE_KINDS,
  type PointKey,
} from "@kb/plugin";
import { ExtensionRowSchema } from "./declaration.ts";
import type { ExtensionFailure } from "./extension.ts";
import { FOOTPRINT_SOURCES, type FamilyKernel } from "./footprint.ts";
const PointSpecSchema = z.object({
  cardinality: z.enum(POINT_CARDINALITIES),
  combine: z.string(),
  kernel: z.union([z.enum(KERNEL_HOSTS), z.array(z.enum(KERNEL_HOSTS)).readonly()]),
  tier: z.enum(POINT_TIERS),
  keyBy: z.string().optional(),
  replaceable: z.boolean().optional(),
  rolePrefix: z.string().optional(),
});

const ExtensionReportRowSchema = ExtensionRowSchema.extend({
  tags: z.array(z.string()),
  declares: z.array(z.object({ point: z.string(), spec: PointSpecSchema })),
  uses: z.array(z.object({ point: z.string(), from: z.string().nullable() })),
  /** Each service its plugins inject, and the plugin that provides it; null while nobody does. */
  injects: z.array(z.object({ service: z.string(), from: z.string().nullable() })),
  provides: z.array(z.string()),
  /** Why each of its plugins that failed to load did. */
  failures: z.array(z.string()),
});

const OrderedPointSchema = z.object({
  point: z.string(),
  owner: z.string().nullable(),
  spec: PointSpecSchema,
  source: z.enum(FOOTPRINT_SOURCES).exclude(["seed"]),
  /** In the order the host asks them; `match` is the calls a listener is asked about, where it names them. */
  listeners: z.array(z.object({ owner: z.string(), id: z.string(), match: z.string().optional() })),
});

const OrderedRoleSchema = z.object({
  role: z.string(),
  kind: z.enum(ROLE_KINDS),
  owner: z.string().nullable(),
  selected: z.string().nullable(),
  elected: z.string().nullable(),
  source: z.enum(FOOTPRINT_SOURCES).exclude(["seed"]),
  candidates: z
    .array(
      z.object({
        owner: z.string(),
        provider: z.string(),
        priority: z.number(),
        default: z.boolean(),
        fault: z.string().nullable(),
      }),
    )
    .readonly(),
});

export type OrderedRole = z.infer<typeof OrderedRoleSchema>;

/** Effective roles, including faulted candidates, in each host's own order. */
export function orderedRoles(kernels: readonly FamilyKernel[]): OrderedRole[] {
  return kernels.flatMap(({ source, kernel }) =>
    kernel.roles().map((role) => ({ ...role, source })),
  );
}

export const ExtensionReportSchema = z.object({
  extensions: z.array(ExtensionReportRowSchema),
  points: z.array(OrderedPointSchema),
  roles: z.array(OrderedRoleSchema),
  /** The repository modules discovery refused, each skipped: one not trusted names its digest. */
  failures: z.array(z.object({ file: z.string(), error: z.string() })),
});

export type ExtensionReportRow = z.infer<typeof ExtensionReportRowSchema>;
export type OrderedPoint = z.infer<typeof OrderedPointSchema>;
export type ExtensionReport = z.infer<typeof ExtensionReportSchema>;

/** The repository modules the host's discovery refused: what the report lists beside the rows. */
export class ExtensionFailures extends Context.Service<
  ExtensionFailures,
  readonly ExtensionFailure[]
>()("kb/ExtensionFailures") {}

/** Whether the plugin `name` is `family`'s: the family's own, or a child it loaded. */
const ownedBy = (family: string) => (name: string) =>
  name === family || name.startsWith(`${family}/`);

/** A host-observed failure of a running plugin, without changing its admission state. */
export interface PluginFailure {
  readonly owner: string;
  readonly message: string;
}

/** How `family`'s plugins sit among the others in `kernels`. */
export function organisationOf(
  family: string,
  kernels: readonly FamilyKernel[],
  runtimeFailures: readonly PluginFailure[] = [],
): Pick<ExtensionReportRow, "tags" | "injects" | "provides" | "failures" | "declares" | "uses"> {
  const own = ownedBy(family);
  const held = kernels.map(({ kernel }) => ({
    kernel,
    plugins: kernel.plugins().filter((plugin) => own(plugin.name)),
  }));
  const plugins = held.flatMap(({ plugins: mine }) => mine);
  const requirements = held.flatMap(({ plugins: mine }) => {
    const needs = mine.flatMap((plugin) => plugin.requirements);
    return [
      ...needs.filter(({ from }) => from !== null),
      ...needs.filter(({ from }) => from === null),
    ];
  });
  return {
    tags: [...new Set(plugins.flatMap((plugin) => plugin.tags))],
    declares: held.flatMap(({ kernel }) =>
      kernel
        .points()
        .filter(({ owner }) => owner !== null && own(owner))
        .map(({ key }) => ({ point: key.name, spec: describeSpec(key) })),
    ),
    uses: requirements
      .filter(({ kind }) => kind === "point")
      .map(({ name, from }) => ({ point: name, from })),
    injects: requirements
      .filter(({ kind }) => kind === "service")
      .map(({ name, from }) => ({ service: name, from })),
    provides: plugins.flatMap((plugin) => plugin.provides),
    failures: [
      ...plugins.flatMap((plugin) => (plugin.error === null ? [] : [plugin.error.message])),
      ...runtimeFailures.filter(({ owner }) => own(owner)).map(({ message }) => message),
    ],
  };
}

function describeSpec(point: PointKey<unknown>): z.infer<typeof PointSpecSchema> {
  const { cardinality, combine, kernel, tier, keyBy, replaceable, rolePrefix } = point.spec;
  return {
    cardinality,
    combine,
    kernel,
    tier,
    ...(keyBy === undefined ? {} : { keyBy }),
    ...(replaceable === undefined ? {} : { replaceable }),
    ...(rolePrefix === undefined ? {} : { rolePrefix }),
  };
}

function listenersAt(
  kernel: FamilyKernel["kernel"],
  point: PointKey<unknown>,
): OrderedPoint["listeners"] {
  return kernel.contributions(point).map(({ owner, id, value }) => {
    const match =
      typeof value === "object" && value !== null && "match" in value ? value.match : undefined;
    return typeof match === "string" ? { owner, id, match } : { owner, id };
  });
}

/** Each ordered point a kernel of `kernels` has listeners at, in that kernel's order. */
export function orderedPoints(kernels: readonly FamilyKernel[]): OrderedPoint[] {
  return kernels.flatMap(({ source, kernel }) =>
    kernel.points().flatMap(({ key: point, owner }) => {
      const listeners = listenersAt(kernel, point);
      return listeners.length === 0 && owner === null
        ? []
        : [
            {
              point: point.name,
              owner,
              spec: describeSpec(point),
              source,
              listeners,
            },
          ];
    }),
  );
}
