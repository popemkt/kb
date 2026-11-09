import { z } from "zod";
import { EXTENSION_NAME_PATTERN, LOCAL_POINT_NAME_PATTERN } from "@kb/plugin";

/** Native slash names and family-local dot names share the same identifier rules. */
const POINT_NAME_PATTERN = new RegExp(
  `^${EXTENSION_NAME_PATTERN.source.slice(1, -1)}[./]${LOCAL_POINT_NAME_PATTERN.source.slice(1, -1)}$`,
);
const THIRD_PARTY_POINT_NAME_PATTERN = new RegExp(
  `^ext\\.${EXTENSION_NAME_PATTERN.source.slice(1, -1)}\\.${LOCAL_POINT_NAME_PATTERN.source.slice(1, -1)}$`,
);
const ROLE_NAME_PATTERN = new RegExp(
  `${POINT_NAME_PATTERN.source.slice(0, -1)}(?::[\\w][\\w.-]*)?$`,
);

export const PointNameSchema = z
  .string()
  .regex(POINT_NAME_PATTERN, "expected a namespaced point name")
  .refine(
    (name) => !name.startsWith("ext.") || THIRD_PARTY_POINT_NAME_PATTERN.test(name),
    "expected ext.<extension>.<local>",
  );
export const PointNamesSchema = z.array(PointNameSchema).readonly();
export const RoleNameSchema = z.string().regex(ROLE_NAME_PATTERN, "expected a role name");

/** Local declarations contain no dots, so the last dot separates the exact owner namespace. */
export function pointOwner(name: string): string {
  const namespace = name.slice(0, Math.max(name.lastIndexOf("."), name.lastIndexOf("/")));
  return namespace.startsWith("ext.") ? namespace.slice(4) : namespace;
}

/** The missing requirement is a waiting state, shared by CLI and Settings. */
export function waitingForPoint(name: string): string {
  return `waiting for ${name} from ${pointOwner(name)}`;
}
