export { PluginError, PluginErrorReason } from "./errors.ts";
export { definePlugin, isPlugin, makeKernel } from "./kernel.ts";
export type {
  Contribution,
  Dependency,
  RequirementState,
  ContributionEntry,
  Kernel,
  Plugin,
  PluginContext,
  PluginHandle,
  PluginState,
  PluginStatus,
  PointContribution,
  PointState,
} from "./kernel.ts";
export {
  PointName,
  Point,
  Service,
  asKeyType,
  KERNEL_HOSTS,
  POINT_CARDINALITIES,
  POINT_TIERS,
} from "./keys.ts";
export { syncPlugins } from "./sync.ts";
export type { SyncFailure } from "./sync.ts";
export type {
  AnyServiceKey,
  Key,
  PointKey,
  PointSpec,
  PointReference,
  KernelHost,
  ServiceKey,
} from "./keys.ts";

export { bindPluginAuthority, type PluginAuthority, type RoleApproval } from "./authority.ts";
export { type RoleCandidate, type RoleState, type RoleProvider } from "./roles.ts";
export {
  Role,
  roleName,
  type RoleKey,
  type ServiceSpec,
  type KernelSpec,
  type RolePolicy,
} from "./keys.ts";

export { roleCall } from "./role-call.ts";

export { namespaced } from "./keys.ts";

export { roleSession, type RoleSession } from "./role-session.ts";

export { ROLE_KINDS } from "./roles.ts";
