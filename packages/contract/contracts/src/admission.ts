import { KERNEL_HOSTS, kernelHosts, type KernelHost, type KernelSpec } from "@kb/plugin";
import type { ExtensionDeclaration } from "./declaration.ts";
import {
  PAGE_TIERS,
  ExtensionManifestSchema,
  type ExtensionManifest,
  type PointUse,
  type PageTier,
} from "./extension-manifest.ts";
import {
  CORE_POINT_NAMESPACES,
  CORE_POINT_DEFINITIONS,
  type PointDefinition,
} from "./point-definitions.ts";
import { declaredRoles, type DeclaredRole } from "./roles.ts";

export interface HostCapabilities {
  readonly points: readonly PointDefinition[];
  readonly roles: readonly DeclaredRole[];
  readonly namespaces: readonly string[];
}

/** The same definitions create keys, declare family points, grant defaults and admit consumers. */
export function hostCapabilities(declarations: readonly ExtensionDeclaration[]): HostCapabilities {
  const points = [
    ...Object.values(CORE_POINT_DEFINITIONS),
    ...declarations.flatMap(({ points: declared }) => declared ?? []),
  ];
  return {
    points,
    roles: declaredRoles(declarations),
    namespaces: [...new Set([...CORE_POINT_NAMESPACES, ...declarations.map(({ name }) => name)])],
  };
}

const PAGE_TIER = { T0: "data", T1: "drawing", T2: "scene", T3: "full" } as const satisfies Record<
  KernelSpec["tier"],
  PageTier
>;

function hostIssue(
  label: string,
  spec: KernelSpec,
  hosts: readonly KernelHost[],
  manifest: ExtensionManifest,
): string | null {
  const accepted = kernelHosts(spec).filter((host) => hosts.includes(host));
  if (accepted.length === 0)
    return `${label}: requires ${kernelHosts(spec).join(" or ")} host capability`;
  if (accepted.includes("page")) {
    const required = PAGE_TIER[spec.tier];
    if (PAGE_TIERS.indexOf(manifest.capabilities?.page ?? "none") < PAGE_TIERS.indexOf(required))
      return `${label}: requires capabilities.page: ${required}`;
  }
  return null;
}

function pointUseIssue(
  use: PointUse,
  requirements: ExtensionManifest,
  catalog: HostCapabilities,
  hosts: readonly KernelHost[],
): string | null {
  const label = `uses ${use.point}`;
  if (!hosts.includes(use.kernel)) return `${label}: unsupported ${use.kernel} host capability`;
  const target = catalog.points.find((point) => point.name === use.point);
  if (target === undefined) {
    const native = catalog.namespaces.some(
      (namespace) => use.point.startsWith(`${namespace}.`) || use.point.startsWith(`${namespace}/`),
    );
    if (native) return `${label}: no point declared by this kb`;
    if (!use.point.startsWith("ext."))
      return `${label}: third-party points must be named ext.<extension>.<local>`;
    return null;
  }
  if (target.declared !== true) return `${label}: this is a static SDK point, not a declared point`;
  const issue = hostIssue(label, target.spec, [use.kernel], requirements);
  if (issue !== null) return issue;
  return null;
}

/** Compatibility is decided from digest-covered data before either half is imported. */
export function extensionAdmissionIssue(
  name: string,
  manifest: ExtensionManifest | undefined,
  catalog: HostCapabilities,
  hosts: readonly KernelHost[] = KERNEL_HOSTS,
): string | null {
  if (manifest === undefined) return null;
  const decoded = ExtensionManifestSchema.safeParse(manifest);
  if (!decoded.success)
    return `manifest: ${decoded.error.issues.map(({ message }) => message).join("; ")}`;
  const requirements = decoded.data;
  for (const use of requirements.uses ?? []) {
    const issue = pointUseIssue(use, requirements, catalog, hosts);
    if (issue !== null) return issue;
  }
  for (const claim of requirements.replaces ?? []) {
    const label = `replaces ${claim.role}`;
    const target = catalog.roles.find(({ role }) => role === claim.role);
    if (target === undefined) return `${label}: no replaceable role declared by this kb`;
    if (target.owner === name) return `${label}: ${name} already owns its default`;
    const issue = hostIssue(label, target.spec, hosts, requirements);
    if (issue !== null) return issue;
  }
  if ((requirements.reacts?.length ?? 0) > 0) {
    const target = catalog.points.find(
      ({ name: pointName }) => pointName === CORE_POINT_DEFINITIONS.txAfter.name,
    );
    if (target === undefined) return "reacts: tx/after is not supported by this kb";
    const issue = hostIssue(
      "reacts",
      target.spec,
      hosts.filter((host) => host === "registry"),
      requirements,
    );
    if (issue !== null) return issue;
  }
  return null;
}
