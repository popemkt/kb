import type { Plugin } from "./kernel.ts";

/** Candidate approval is a host capability, never a field supplied by a plugin. */
export interface RoleApproval {
  readonly role: string;
  readonly priority?: number;
}

interface RoleOwner {
  readonly role: string;
  readonly provider: string;
}

export interface PluginAuthority {
  readonly pointNamespace: string;
  readonly source: "bundled" | "extension";
  readonly replacements: readonly RoleApproval[];
  readonly defaults: readonly RoleOwner[];
  readonly digest?: string;
}

const authorities = new WeakMap<Plugin, PluginAuthority>();

export function bindPluginAuthority(plugin: Plugin, authority: PluginAuthority): Plugin {
  const bound = { ...plugin };
  authorities.set(
    bound,
    Object.freeze({
      ...authority,
      defaults: Object.freeze(authority.defaults.map((entry) => Object.freeze({ ...entry }))),
      replacements: Object.freeze(
        authority.replacements.map((entry) => Object.freeze({ ...entry })),
      ),
    }),
  );
  return bound;
}

export function authorityOf(plugin: Plugin): PluginAuthority | undefined {
  return authorities.get(plugin);
}
