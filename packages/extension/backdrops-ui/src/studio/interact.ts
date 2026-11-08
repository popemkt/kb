/**
 * Backdrop Studio's Interact mode (DESIGN-UI.md → Backdrop Studio →
 * Interact): what the studio hands a scene in place of a page's owner, so a
 * person can try what it answers (`Backdrop.interactions`). The pointer is
 * the person's own, over the scene; every other cue is acted out: a burst
 * of typing, a write, another page, or one of the page's events. A scene
 * reads them as it reads a page's (`PageActivity`, its `node`), so what it
 * shows here is what a page would make it show.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  QUIET_ACTIVITY,
  type BackdropCue,
  type OutlineNode,
  type PageActivity,
  type PointerSource,
} from "@kb/ui-sdk";

/** The cues the studio acts out; the pointer is the person's own. */
export type ActedCue = Exclude<BackdropCue, "pointer">;

/** A burst of typing: this many keystrokes, this far apart, then the owner stops after a pause. */
export const TYPING_KEYSTROKES = 12;
const TYPING_EVERY_MS = 140;
const TYPING_PAUSE_MS = 500;

/** The activity after one cue that is a single moment: a write, or one of the page's events, counted once more. */
export function afterMoment(
  activity: PageActivity,
  cue: Exclude<ActedCue, "editing" | "navigation">,
): PageActivity {
  return { ...activity, [cue]: activity[cue] + 1 };
}

/** One step of a burst of typing, at `at` ms after it began: editing, and each keystroke a write, until it stops. */
export interface TypingStep {
  readonly at: number;
  readonly step: (activity: PageActivity) => PageActivity;
}

/** A burst of typing, step by step: editing begins, each keystroke writes, editing ends after a pause. */
export function typingBurst(): readonly TypingStep[] {
  const keystrokes = Array.from({ length: TYPING_KEYSTROKES }, (_, i) => ({
    at: i * TYPING_EVERY_MS,
    step: (activity: PageActivity) => ({ ...activity, editing: true, writes: activity.writes + 1 }),
  }));
  const end = (TYPING_KEYSTROKES - 1) * TYPING_EVERY_MS + TYPING_PAUSE_MS;
  return [...keystrokes, { at: end, step: (activity) => ({ ...activity, editing: false }) }];
}

/** The person's pointer as the scene is handed it, and the switch that opens it. */
export interface GatedPointer {
  /** `source` while open, else no pointer at all. */
  readonly pointer: PointerSource;
  readonly open: (open: boolean) => void;
}

/**
 * The person's pointer behind Interact's switch: one source, whatever the
 * switch says, so turning Interact on or off hands the scene nothing new.
 * A scene that sets itself up around its pointer (`GpuBackdrop`) keeps
 * running, and only what `now()` answers changes. Closed until opened.
 */
export function gatedPointer(source: PointerSource): GatedPointer {
  let open = false;
  return {
    pointer: { now: () => (open ? source.now() : null) },
    open: (next) => {
      open = next;
    },
  };
}

/** A page the studio shows instead of none, so moving to another is a page change a scene hears. */
function previewNode(n: number): OutlineNode {
  return {
    id: `studio.preview.${n}`,
    text: "",
    parentId: null,
    children: [],
    collapsed: false,
    props: {},
    createdAt: "",
    updatedAt: "",
    tags: [],
  };
}

export interface StudioActivity {
  /** What the scene is handed as the owner's activity. */
  readonly activity: PageActivity;
  /** What it is handed as the page shown: none, until the person moves to another. */
  readonly node: OutlineNode | undefined;
  /** Act out `cue` once. */
  readonly act: (cue: ActedCue) => void;
  /** Whether a burst of typing is under way. */
  readonly typing: boolean;
}

/**
 * The owner the studio acts out. Quiet until a cue is acted; a burst of
 * typing plays over a couple of seconds, and acting it again while it
 * plays starts none over it.
 */
export function useStudioActivity(): StudioActivity {
  const [activity, setActivity] = useState<PageActivity>(QUIET_ACTIVITY);
  const [pages, setPages] = useState(0);
  const [typing, setTyping] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );
  const act = useCallback(
    (cue: ActedCue) => {
      if (cue === "navigation") {
        setPages((n) => n + 1);
        return;
      }
      if (cue !== "editing") {
        setActivity((now) => afterMoment(now, cue));
        return;
      }
      if (typing) return;
      setTyping(true);
      const burst = typingBurst();
      for (const [i, { at, step }] of burst.entries()) {
        const last = i === burst.length - 1;
        timers.current.push(
          setTimeout(() => {
            setActivity(step);
            if (last) setTyping(false);
          }, at),
        );
      }
    },
    [typing],
  );
  return { activity, node: pages === 0 ? undefined : previewNode(pages), act, typing };
}
