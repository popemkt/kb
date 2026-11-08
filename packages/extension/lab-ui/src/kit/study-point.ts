/**
 * The studies the lab can show now, as contributions: each study the lab
 * holds is offered here by the plugin that can draw it. A study that reads
 * the graph (`LabStudy.readsGraph`) is offered by the lab's graph child,
 * which injects the graph's `NodeLinkGraphService`, so that study waits, pending,
 * while the graph is off, and every other study shows.
 */
import { PointName, type PointSpec } from "@kb/plugin";
import type { LabSceneId } from "@kb/lab";
import type { LabStudy } from "./contract";

export interface LabStudyEntry {
  readonly scene: LabSceneId;
  readonly study: LabStudy;
}

export const LabStudyPoint = PointName<LabStudyEntry>()("lab.studies");
export const LAB_STUDY_POINT_SPEC: PointSpec = {
  cardinality: "keyed",
  combine: "lookup by scene",
  kernel: "page",
  tier: "T3",
  keyBy: "scene",
};
