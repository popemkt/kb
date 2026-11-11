import type { IsomorphicActionEnv } from "@kb/contracts";
import { coreNative, type RegisteredAction } from "./invoke.ts";
import {
  fieldDefineDef,
  fieldDefineEffect,
  graphQueryDef,
  graphQueryEffect,
  graphSearchDef,
  graphSearchEffect,
  graphChangesDef,
  graphChangesEffect,
  nodeAddDef,
  nodeAddEffect,
  nodeDeleteDef,
  nodeDeleteEffect,
  nodeGetDef,
  nodeGetEffect,
  nodeMergeDef,
  nodeMergeEffect,
  nodeUpdateDef,
  nodeUpdateEffect,
  tagDefineDef,
  tagDefineEffect,
} from "./actions.ts";
import { nodeAddTreeDef, nodeAddTreeEffect } from "./node-add-tree.ts";
import { viewProposeDef, viewProposeEffect } from "./view-propose.ts";
import { viewOpeningsDef, viewOpeningsEffect } from "./view-openings.ts";
import { ontologyMembersDef, ontologyMembersEffect } from "./ontology.ts";

/** The handlers whose complete environment exists in every runtime. */
export const isomorphicActions: readonly RegisteredAction<IsomorphicActionEnv>[] = [
  coreNative(nodeAddDef, nodeAddEffect),
  coreNative(nodeAddTreeDef, nodeAddTreeEffect),
  coreNative(nodeUpdateDef, nodeUpdateEffect),
  coreNative(nodeDeleteDef, nodeDeleteEffect),
  coreNative(nodeMergeDef, nodeMergeEffect),
  coreNative(nodeGetDef, nodeGetEffect),
  coreNative(fieldDefineDef, fieldDefineEffect),
  coreNative(tagDefineDef, tagDefineEffect),
  coreNative(graphQueryDef, graphQueryEffect),
  coreNative(graphSearchDef, graphSearchEffect),
  coreNative(graphChangesDef, graphChangesEffect),
  coreNative(ontologyMembersDef, ontologyMembersEffect),
  coreNative(viewProposeDef, viewProposeEffect),
  coreNative(viewOpeningsDef, viewOpeningsEffect),
];
