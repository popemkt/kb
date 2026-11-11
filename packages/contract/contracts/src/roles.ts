import { manifestAuthority } from "./manifest-authority.ts";
import type { RoleDefinition } from "@kb/model";
import { bindPluginAuthority, type ServiceSpec, type Plugin } from "@kb/plugin";
import { ExtensionManifestSchema } from "./extension-manifest.ts";
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

/**
 * Where a node made with no chosen place goes (DESIGN.md → Provider roles):
 * a page service answering the parent's id, or null for the top level.
 * Core owns it and answers the top level; days replaces it with today.
 */
export const CAPTURE_TARGET_ROLE = {
  role: "ui.capture-target",
  label: "Capture target",
  spec: { kernel: "page", tier: "T3", replaceable: true },
} as const satisfies ProviderRole;

/**
 * Where a page that loads at the root opens (DESIGN.md → Provider roles): a
 * page service answering the node to open, or null to stay home. The shell
 * asks it once per page load. Core owns it and stays home; days replaces it
 * with today.
 */
export const LANDING_ROLE = {
  role: "ui.landing",
  label: "Landing",
  spec: { kernel: "page", tier: "T3", replaceable: true },
} as const satisfies ProviderRole;

/**
 * Where a date leads (DESIGN.md → Provider roles): a page service answering
 * the node a date value opens when followed, made if need be, or null when
 * a date leads nowhere. Core owns it and leads nowhere; days replaces it
 * with the date's day.
 */
export const DATE_TARGET_ROLE = {
  role: "ui.date-target",
  label: "Date target",
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
    ...manifestAuthority(manifest),
    defaults: (declaration.roles ?? []).map(({ role }) => ({ role, provider: declaration.name })),
  });
}

export interface DeclaredRole extends ProviderRole {
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
