import { create } from "zustand";
import type { Person } from "@kb/contracts";
import type { WsStatus } from "@/api/ws";
import { QUIET_ACTIVITY, setToastSink, type PageEvents } from "@kb/ui-sdk";

export interface Toast {
  id: number;
  kind: "error" | "info";
  text: string;
  /** How many times this same message arrived while it was on screen. */
  count: number;
}

/** At most this many toasts show at once; the oldest yields. */
export const TOAST_LIMIT = 3;
const TOAST_MS = 6000;

/**
 * The toast list after `incoming` arrives. A message already on screen is not
 * stacked a second time: it moves to the newest slot with its count raised
 * (and a fresh id, so its timer restarts). The list keeps the newest
 * `TOAST_LIMIT`.
 */
export function withToast(
  toasts: readonly Toast[],
  incoming: { id: number; kind: Toast["kind"]; text: string },
): Toast[] {
  const same = (t: Toast) => t.kind === incoming.kind && t.text === incoming.text;
  const count = (toasts.find(same)?.count ?? 0) + 1;
  return [...toasts.filter((t) => !same(t)), { ...incoming, count }].slice(-TOAST_LIMIT);
}

interface UiState {
  wsStatus: WsStatus;
  /**
   * Who the server takes this tab's connection to be: the person, nobody
   * (`null`), or not told yet (`undefined`).
   */
  person: Person | null | undefined;
  toasts: Toast[];
  /**
   * The sidebar floating over a narrow viewport. Transient, like a popover:
   * the docked sidebar's open state is a device preference (`sidebarOpen`),
   * and a narrow screen never inherits it.
   */
  sidebarOverlayOpen: boolean;
  globalPaletteOpen: boolean;
  nodePaletteOpen: boolean;
  /** W7.1: open filter popover for this frame (toolbar ⚙ / palette Filter…). */
  viewSettingsFrameId: string | null;
  /**
   * The dock open at the workspace's right edge (`DockPoint`), by its
   * contribution id; null when none is. One at a time, and transient.
   */
  openDock: string | null;

  setWsStatus: (status: WsStatus) => void;
  setPerson: (person: Person | null) => void;
  setSidebarOverlayOpen: (open: boolean) => void;
  setGlobalPaletteOpen: (open: boolean) => void;
  setNodePaletteOpen: (open: boolean) => void;
  setViewSettingsFrameId: (frameId: string | null) => void;
  setOpenDock: (dock: string | null) => void;
  /**
   * What has happened on the page, counted (`BrowserHost.events`). An error
   * is counted where every error the owner is told of passes: `pushToast`.
   */
  events: PageEvents;
  /** Count one change from elsewhere shown, or one turn the agent finished. */
  noteEvent: (event: "arrivals" | "turns") => void;
  pushToast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
}

const NO_EVENTS: PageEvents = {
  arrivals: QUIET_ACTIVITY.arrivals,
  errors: QUIET_ACTIVITY.errors,
  turns: QUIET_ACTIVITY.turns,
};

let toastSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  wsStatus: "idle",
  person: undefined,
  toasts: [],
  sidebarOverlayOpen: false,
  globalPaletteOpen: false,
  nodePaletteOpen: false,
  viewSettingsFrameId: null,
  openDock: null,
  events: NO_EVENTS,

  // Whose a connection is, it is told after it opens; a closed one is no one's yet.
  setWsStatus: (wsStatus) =>
    set(wsStatus === "open" ? { wsStatus } : { wsStatus, person: undefined }),
  setPerson: (person) => set({ person }),
  setSidebarOverlayOpen: (sidebarOverlayOpen) => set({ sidebarOverlayOpen }),
  setGlobalPaletteOpen: (globalPaletteOpen) =>
    set((s) => ({
      globalPaletteOpen,
      nodePaletteOpen: globalPaletteOpen ? false : s.nodePaletteOpen,
    })),
  setNodePaletteOpen: (nodePaletteOpen) =>
    set((s) => ({
      nodePaletteOpen,
      globalPaletteOpen: nodePaletteOpen ? false : s.globalPaletteOpen,
    })),
  setViewSettingsFrameId: (viewSettingsFrameId) => set({ viewSettingsFrameId }),
  setOpenDock: (openDock) => set({ openDock }),

  noteEvent: (event) => set((s) => ({ events: { ...s.events, [event]: s.events[event] + 1 } })),

  pushToast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({
      toasts: withToast(s.toasts, { id, kind, text }),
      events: kind === "error" ? { ...s.events, errors: s.events.errors + 1 } : s.events,
    }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, TOAST_MS);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * The store is the toast sink `lib/toast` declares. Registered at module scope
 * rather than from a boot step: `toast()` is called from zones that may not
 * reach a store, and every code path that can render a toast has already
 * imported this module — App renders `<Toasts/>` from it.
 */
setToastSink((message) => {
  useUiStore.getState().pushToast("error", message);
});
