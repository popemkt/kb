/**
 * How this page reloads into a newer build when it must (DESIGN-UI.md →
 * Delivery, "A tab outlives its build"). `@kb/ui-sdk` → `lib/stale-build`
 * decides that a reload is needed and orders it; this module says what the
 * page means by its three steps:
 *
 * - **idle**: no write the server has not confirmed (`BrowserReplica`'s
 *   holds, typed text included), no draft open in a field that keeps its
 *   text until it is committed, and a pause in the person's typing and
 *   clicking. An outline row is no draft: each keystroke is a write.
 * - **carry**: what the page comes back to. The route is the URL and the
 *   panes are the workspace's, which a reload keeps already; this writes
 *   down where each pane is scrolled and where the caret is.
 * - **announce**: the reload chip (`components/App.tsx`).
 */
import { z } from "zod";
import {
  browserBuildEnv,
  getCaretSerializedOffset,
  watchForNewBuild,
  type ReloadState,
} from "@kb/ui-sdk";
import { browserReplica } from "@/session/runtime";
import { pageEditor } from "@/stores/page-editor";
import { useUiStore } from "@/stores/ui.store";

/** Where the carried state waits in the tab's session storage, read once by the next page. */
const CARRIED = "kb.carried";
/** A pause this long in typing and clicking is idle. */
const QUIET_MS = 1500;
const POLL_MS = 400;
/** How long the next page looks for what it was carried to before it gives up. */
const RESTORE_MS = 10_000;

/** Each pane's scroll region (`PageFrame`), in the workspace's order, which a reload keeps. */
const SCROLL_REGIONS = '[data-main-region="scroll"]';

const CarriedSchema = z.object({
  scroll: z.array(z.object({ top: z.number(), left: z.number() })),
  caret: z.object({ nodeId: z.string(), instanceKey: z.string(), at: z.number() }).nullable(),
});
type Carried = z.infer<typeof CarriedSchema>;

/** When the person last typed or clicked. */
let lastInput = Number.NEGATIVE_INFINITY;

const TEXT_INPUTS = new Set(["text", "search", "url", "email", "tel", "password", "number"]);

/** Whether `active` holds text that is not written until it is committed: a draft. */
function drafting(active: Element | null): boolean {
  if (active instanceof HTMLTextAreaElement) return true;
  if (active instanceof HTMLInputElement) return TEXT_INPUTS.has(active.type);
  // A row's text (`kb-text`) is written as it is typed; any other editable is not.
  return active instanceof HTMLElement && active.isContentEditable && !active.closest(".kb-text");
}

/** Whether a reload now would lose nothing the page holds. */
export function idleNow(now: number = performance.now()): boolean {
  return (
    (browserReplica()?.state.holds ?? 0) === 0 &&
    !drafting(document.activeElement) &&
    now - lastInput >= QUIET_MS
  );
}

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    const look = (): void => {
      if (idleNow()) resolve();
      else setTimeout(look, POLL_MS);
    };
    look();
  });
}

/** Write down where each pane is scrolled and where the caret is, for the next page. */
export function carryPage(storage: Pick<Storage, "setItem"> = sessionStorage): void {
  const scroll = [...document.querySelectorAll<HTMLElement>(SCROLL_REGIONS)].map((region) => ({
    top: region.scrollTop,
    left: region.scrollLeft,
  }));
  const { activeNodeId, activeInstanceKey } = pageEditor().getState();
  const active = document.activeElement;
  const caret =
    activeNodeId !== null &&
    activeInstanceKey !== null &&
    active instanceof HTMLElement &&
    active.isContentEditable
      ? {
          nodeId: activeNodeId,
          instanceKey: activeInstanceKey,
          at: getCaretSerializedOffset(active),
        }
      : null;
  const carried: Carried = { scroll, caret };
  try {
    storage.setItem(CARRIED, JSON.stringify(carried));
  } catch {
    // Storage refused: the page comes back where the URL says, unscrolled.
  }
}

/** Put back one carried thing; true once it is back. */
type Putting = () => boolean;

function scrollBack(index: number, to: Carried["scroll"][number]): Putting {
  return () => {
    const region = document.querySelectorAll<HTMLElement>(SCROLL_REGIONS)[index];
    if (region === undefined || region.scrollHeight - region.clientHeight < to.top) return false;
    region.scrollTo({ top: to.top, left: to.left });
    return true;
  };
}

function caretBack(to: NonNullable<Carried["caret"]>, panes: number): Putting {
  return () => {
    // Until every carried pane is drawn the page is still taking its shape:
    // a row drawn in its first layout is drawn again in the last, and a caret
    // placed in the first is lost with it.
    if (document.querySelectorAll(SCROLL_REGIONS).length < panes) return false;
    const rows = document.querySelectorAll("[data-instance-key]");
    if (![...rows].some((row) => row.getAttribute("data-instance-key") === to.instanceKey)) {
      return false;
    }
    pageEditor().getState().activateNode(to.nodeId, to.at, to.instanceKey);
    return true;
  };
}

/**
 * Put the page back as the page before the reload carried it: each pane's
 * scroll once its content is tall enough, the caret once every pane is drawn
 * and its row is among them.
 * What is not back within {@link RESTORE_MS} is left. Carried state is read
 * once, so a later reload of this tab starts fresh.
 */
export function restoreCarried(
  storage: Pick<Storage, "getItem" | "removeItem"> = sessionStorage,
): void {
  let text: string | null = null;
  try {
    text = storage.getItem(CARRIED);
    storage.removeItem(CARRIED);
  } catch {
    return;
  }
  if (text === null) return;
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    return;
  }
  const carried = CarriedSchema.safeParse(json);
  if (!carried.success) return;
  const { scroll, caret } = carried.data;
  let putting: Putting[] = [
    ...scroll.map((to, index) => scrollBack(index, to)),
    ...(caret === null ? [] : [caretBack(caret, scroll.length)]),
  ];
  const until = performance.now() + RESTORE_MS;
  const step = (): void => {
    putting = putting.filter((put) => !put());
    if (putting.length > 0 && performance.now() < until) requestAnimationFrame(step);
  };
  step();
}

function noteInput(): void {
  lastInput = performance.now();
}

/**
 * Follow this page's build, as the shell of a built page does once: reload
 * when the protocol or a missing chunk asks for it, when idle, carrying the
 * page, with the chip saying so. Returns the uninstall.
 */
export function followPageBuild(target: Window = window): () => void {
  target.addEventListener("keydown", noteInput, { capture: true });
  target.addEventListener("pointerdown", noteInput, { capture: true });
  const stop = watchForNewBuild(target, {
    ...browserBuildEnv(),
    idle: whenIdle,
    carry: () => carryPage(),
    announce: (state: ReloadState) => useUiStore.getState().setReload(state),
  });
  return () => {
    stop();
    target.removeEventListener("keydown", noteInput, { capture: true });
    target.removeEventListener("pointerdown", noteInput, { capture: true });
  };
}
