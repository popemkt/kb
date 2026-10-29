/**
 * The owner, as a backdrop's host tells it to the scene's reactions
 * (`reactions.ts`): the page's activity (`PageActivity`) and the page shown.
 * The 2D stage and the GPU stage are hosted alike, so both tell it here: a
 * count that moved is one event, a page change is a navigation, and editing
 * is a state.
 */
import { useEffect, useRef } from "react";
import type { PageActivity } from "@kb/ui-sdk";
import type { Reactions } from "./reactions";

/** What hears the owner: a stage's reactions, or a scene that hands them on. */
export type Hears = Pick<Reactions, "write" | "navigate" | "setEditing">;

/** The owner as last told: the activity, and the node the page shows. */
export interface Told {
  readonly activity: PageActivity;
  readonly nodeId: string | undefined;
}

/** Tell `hears` what moved between `seen` and `now`, and answer what is seen now. */
export function tellOwner(hears: Hears, seen: Told, now: Told): Told {
  if (now.activity.writes !== seen.activity.writes) hears.write();
  if (now.nodeId !== seen.nodeId) hears.navigate();
  hears.setEditing(now.activity.editing);
  return now;
}

/**
 * Tell what `hears` answers (null while nothing is mounted to hear) each
 * time the owner moves. While nothing hears, nothing is seen: what moved is
 * told to the first scene that does. `hears` is stable: it reads what is
 * mounted now, through a ref.
 */
export function useTellOwner(
  hears: () => Hears | null,
  activity: PageActivity,
  nodeId: string | undefined,
): void {
  const seen = useRef<Told>({ activity, nodeId });
  useEffect(() => {
    const target = hears();
    if (target === null) return;
    seen.current = tellOwner(target, seen.current, { activity, nodeId });
  }, [hears, activity, nodeId]);
}
