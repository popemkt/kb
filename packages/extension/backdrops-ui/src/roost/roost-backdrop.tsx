import type { BackdropProps } from "@kb/appearance-kit";
import { SceneStage } from "../scene/scene-stage";
import { createRoost } from "./roost-scene";

/** The Roost backdrop: bats under a house's eaves, asleep by day, stirring at night. */
export function RoostBackdrop(props: BackdropProps) {
  return <SceneStage factory={createRoost} backdrop={props} />;
}
