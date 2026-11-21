/**
 * Scripts (DESIGN.md → Sandbox → Scripts): `#script` nodes that add
 * behaviour to a view, named on the node a view shows by `sys.f.scripts`,
 * resolved as `sys.f.views` is (`hostViewIds`). A script keeps its code and
 * grant in a code view's two fields and runs on the same runner, under the
 * same trust, as the `script` actor, hearing the events its view declares.
 */
import { Result } from "effect";
import {
  nodeName,
  firstStr,
  refValuesOf,
  typeRefsOf,
  type KbNode,
  type NodeId,
  type NodeLike,
} from "@kb/model";
import type { CodeGrant } from "@kb/sandbox";
import { CODE_IDS } from "./ids.ts";
import { grantOfText } from "./view.ts";

/** A script as it runs: its node, what it is called, its code as stored, and its grant. */
export interface ScriptSource {
  readonly id: NodeId;
  readonly label: string;
  readonly code: string;
  readonly grant: CodeGrant;
}

/** The scripts `host` names, in order (`sys.f.scripts`). */
export function scriptIdsOf(host: Pick<NodeLike, "props"> | undefined): NodeId[] {
  return refValuesOf(host, CODE_IDS.scriptsField);
}

/**
 * The node `id` as a script, named by its name (`nodeName`), or null when
 * it is none kb can run: it is missing, it is not tagged
 * `#script` (so writing it is not configuration), it holds no code, or a
 * grant that does not read as one. No grant is the default (it reads
 * the node it runs for, and calls nothing).
 */
export function scriptOf(
  id: NodeId,
  nodeOf: (id: NodeId) => Pick<KbNode, "text" | "props"> | undefined,
): ScriptSource | null {
  const node = nodeOf(id);
  if (node === undefined || !typeRefsOf(node).includes(CODE_IDS.scriptTag)) return null;
  const code = node.props[CODE_IDS.codeField]?.find((value) => value.t === "str")?.v;
  if (code === undefined || code.trim() === "") return null;
  const grant = grantOfText(firstStr(CODE_IDS.codeGrantField)(node.props));
  if (Result.isFailure(grant)) return null;
  return { id, label: nodeName(id, nodeOf) || id, code, grant: grant.success };
}
