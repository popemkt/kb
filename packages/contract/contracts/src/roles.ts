import type { RoleDefinition } from "@kb/model";
import { bindPluginAuthority, kernelHosts, type ServiceSpec, type Plugin } from "@kb/plugin";
import {
  PAGE_TIERS,
  ExtensionManifestSchema,
  type PageTier,
  type ExtensionManifest,
} from "./extension-manifest.ts";
import type { ExtensionDeclaration } from "./declaration.ts";

export interface ProviderRole extends RoleDefinition {
  readonly spec: ServiceSpec & { readonly replaceable: true };
}

/** The owner declaration and the page key derive from this one role definition. */
export const FIELD_EDITOR_ROLE = {
  role: "ui.field-editor",
  label: "Field editor",
  spec: { kernel: "page", tier: "T3", replaceable: true },
} as const satisfies ProviderRole;

/** Bundled composition grants its declaration's defaults; the provider cannot grant itself a role. */
export function bundledPlugin(declaration: ExtensionDeclaration, plugin: Plugin): Plugin {
  const manifest =
    declaration.manifest === undefined
      ? undefined
      : ExtensionManifestSchema.parse(declaration.manifest);
  return bindPluginAuthority(plugin, {
    pointNamespace: declaration.name,
    source: "bundled",
    replacements: manifest?.replaces ?? [],
    defaults: (declaration.roles ?? []).map(({ role }) => ({ role, provider: declaration.name })),
  });
}

interface DeclaredRole extends ProviderRole {
  readonly owner: string;
}

/** One catalog derived from the same declarations that grant and seed the default roles. */
export function declaredRoles(
  declarations: readonly ExtensionDeclaration[],
): readonly DeclaredRole[] {
  return declarations.flatMap(({ name, roles }) =>
    (roles ?? []).map((role) => ({ ...role, owner: name })),
  );
}

const ROLE_PAGE_TIER = {
  T0: "data",
  T1: "drawing",
  T2: "scene",
  T3: "full",
} as const satisfies Record<ServiceSpec["tier"], PageTier>;

/** Compatibility is checked on manifest data before importing any extension code. */
export function replacementIssue(
  name: string,
  manifest: ExtensionManifest | undefined,
  roles: readonly DeclaredRole[],
): string | null {
  for (const claim of manifest?.replaces ?? []) {
    const target = roles.find(({ role }) => role === claim.role);
    if (target === undefined)
      return `replaces ${claim.role}: no replaceable role declared by this kb`;
    if (target.owner === name) return `replaces ${claim.role}: ${name} already owns its default`;
    const required = ROLE_PAGE_TIER[target.spec.tier];
    if (
      kernelHosts(target.spec).includes("page") &&
      PAGE_TIERS.indexOf(manifest?.capabilities?.page ?? "none") < PAGE_TIERS.indexOf(required)
    )
      return `replaces ${claim.role}: requires capabilities.page: ${required}`;
  }
  return null;
}
