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
import type { PointKey } from "@kb/plugin";
import { ExtensionRowSchema } from "./declaration.ts";
import type { ExtensionFailure } from "./extension.ts";
import { FOOTPRINT_SOURCES, type FamilyKernel } from "./footprint.ts";
import { ActionGuardPoint, ActionInterceptorPoint } from "./interception.ts";
import { IdentityPoint } from "./person.ts";

/**
 * The points a host asks its listeners at in turn, so their order is what
 * they do: who a request is (the first answer holds), then what a call runs
 * with, then whether it may run.
 */
const ORDERED_POINTS: readonly PointKey<unknown>[] = [
  IdentityPoint,
  ActionInterceptorPoint,
  ActionGuardPoint,
];

const ExtensionReportRowSchema = ExtensionRowSchema.extend({
  tags: z.array(z.string()),
  /** Each service its plugins inject, and the plugin that provides it; null while nobody does. */
  injects: z.array(z.object({ service: z.string(), from: z.string().nullable() })),
  provides: z.array(z.string()),
  /** Why each of its plugins that failed to load did. */
  failures: z.array(z.string()),
});

const OrderedPointSchema = z.object({
  point: z.string(),
  source: z.enum(FOOTPRINT_SOURCES).exclude(["seed"]),
  /** In the order the host asks them; `match` is the calls a listener is asked about, where it names them. */
  listeners: z.array(z.object({ owner: z.string(), id: z.string(), match: z.string().optional() })),
});

export const ExtensionReportSchema = z.object({
  extensions: z.array(ExtensionReportRowSchema),
  points: z.array(OrderedPointSchema),
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

/** How `family`'s plugins sit among the others in `kernels`. */
export function organisationOf(
  family: string,
  kernels: readonly FamilyKernel[],
): Pick<ExtensionReportRow, "tags" | "injects" | "provides" | "failures"> {
  const own = ownedBy(family);
  const held = kernels.map(({ kernel }) => ({
    kernel,
    plugins: kernel.plugins().filter((plugin) => own(plugin.name)),
  }));
  const plugins = held.flatMap(({ plugins: mine }) => mine);
  return {
    tags: [...new Set(plugins.flatMap((plugin) => plugin.tags))],
    injects: held.flatMap(({ kernel, plugins: mine }) => [
      ...kernel
        .dependencies()
        .filter((edge) => own(edge.from))
        .map(({ service, to }) => ({ service, from: to })),
      ...mine.flatMap((plugin) => plugin.missing.map((service) => ({ service, from: null }))),
    ]),
    provides: plugins.flatMap((plugin) => plugin.provides),
    failures: plugins.flatMap((plugin) => (plugin.error === null ? [] : [plugin.error.message])),
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
    ORDERED_POINTS.flatMap((point) => {
      const listeners = listenersAt(kernel, point);
      return listeners.length === 0 ? [] : [{ point: point.name, source, listeners }];
    }),
  );
}
