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
