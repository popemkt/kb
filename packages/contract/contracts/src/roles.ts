import type { RoleDefinition } from "@kb/model";
import { bindPluginAuthority, type ServiceSpec, type Plugin } from "@kb/plugin";
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
  return bindPluginAuthority(plugin, {
    pointNamespace: declaration.name,
    source: "bundled",
    replacements: [],
    defaults: (declaration.roles ?? []).map(({ role }) => ({ role, provider: declaration.name })),
  });
}
