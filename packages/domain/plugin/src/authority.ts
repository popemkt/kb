import { Result } from "effect";
import type { Plugin } from "./kernel.ts";

export const DEFAULT_REPLACEMENT_PRIORITY = 50;

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

/** The host-bound claim is the one authority used by registration and inspection. */
export function replacementClaim(
  authority: PluginAuthority,
  role: string | null,
): Result.Result<(RoleApproval & { readonly priority: number }) | undefined, string> {
  const claim = authority.replacements.find((entry) => entry.role === role);
  if (claim === undefined) return Result.succeed(undefined);
  if (authority.defaults.some((entry) => entry.role === role))
    return Result.fail(`role ${role} already belongs to its default provider`);
  if (authority.source === "extension" && authority.digest === undefined)
    return Result.fail(`role ${role} requires authority for trusted code`);
  const priority = claim.priority ?? DEFAULT_REPLACEMENT_PRIORITY;
  return Number.isFinite(priority)
    ? Result.succeed({ ...claim, priority })
    : Result.fail(`role ${role} requires a finite priority`);
}
