/** Fault memory belongs to a page/process session, rather than one registry reading. */
export interface RoleSession {
  readonly identity: (provider: string, digest: string) => object;
  readonly faultOf: (role: string, identity: object) => string | null;
  readonly fault: (role: string, identity: object, cause: string) => boolean;
}

export function roleSession(): RoleSession {
  const identities = new Map<string, Map<string, object>>();
  const faults = new Map<string, WeakMap<object, string>>();
  return {
    identity: (provider, digest) => {
      const versions = identities.get(provider) ?? new Map<string, object>();
      let identity = versions.get(digest);
      if (identity === undefined) {
        identity = Object.freeze({});
        versions.set(digest, identity);
        identities.set(provider, versions);
      }
      return identity;
    },
    faultOf: (role, identity) => faults.get(role)?.get(identity) ?? null,
    fault: (role, identity, cause) => {
      const held = faults.get(role) ?? new WeakMap<object, string>();
      if (held.has(identity)) return false;
      held.set(identity, cause);
      faults.set(role, held);
      return true;
    },
  };
}
