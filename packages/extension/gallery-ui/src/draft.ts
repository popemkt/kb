/**
 * The look being made: one draft, shared by every workflow on the page, so
 * changing the way in keeps what has been made (DESIGN-UI.md → The
 * gallery). It is kept in the tab's session storage, so a reload keeps it
 * too; saving writes it as a `#look` node (`save-look.ts`). The last
 * workflow chosen is kept on the device, so `/gallery` offers it first.
 */
import { useSyncExternalStore } from "react";
import { EMPTY_LOOK, type LookDraft } from "@kb/gallery";

const DRAFT_KEY = "kb-gallery-draft";
const WORKFLOW_KEY = "kb-gallery-workflow";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const strings = (v: unknown): readonly string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const idOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A stored draft read back; anything it cannot read is the empty look's. */
function draftOf(raw: string | null): LookDraft {
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    return EMPTY_LOOK;
  }
  if (!isRecord(parsed)) return EMPTY_LOOK;
  const pins = Array.isArray(parsed["pins"])
    ? parsed["pins"]
        .filter(isRecord)
        .flatMap((p) =>
          typeof p["visual"] === "string"
            ? [{ id: idOrNull(p["id"]), visual: p["visual"], note: text(p["note"]) }]
            : [],
        )
    : [];
  return {
    id: idOrNull(parsed["id"]),
    name: text(parsed["name"]),
    description: text(parsed["description"]),
    styles: strings(parsed["styles"]),
    negative: text(parsed["negative"]),
    palette: strings(parsed["palette"]),
    pins,
    forNode: idOrNull(parsed["forNode"]),
  };
}

function storage(kind: "session" | "local"): Storage | null {
  try {
    return kind === "session" ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

let draft: LookDraft = draftOf(storage("session")?.getItem(DRAFT_KEY) ?? null);
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The draft, re-read whenever it changes. */
export function useDraft(): LookDraft {
  return useSyncExternalStore(
    subscribe,
    () => draft,
    () => draft,
  );
}

/** The draft now, for a handler outside render. */
export function currentDraft(): LookDraft {
  return draft;
}

/** Change the draft. */
export function updateDraft(change: (before: LookDraft) => LookDraft): void {
  const next = change(draft);
  if (next === draft) return;
  draft = next;
  storage("session")?.setItem(DRAFT_KEY, JSON.stringify(draft));
  for (const listener of listeners) listener();
}

/** The draft with `styleId` chosen if it was not, unchosen if it was. */
export function toggleDraftStyle(styleId: string): void {
  updateDraft((d) => ({
    ...d,
    styles: d.styles.includes(styleId)
      ? d.styles.filter((s) => s !== styleId)
      : [...d.styles, styleId],
  }));
}

/** The draft with `styleIds` chosen, those already chosen kept. */
export function addDraftStyles(styleIds: readonly string[]): void {
  updateDraft((d) => {
    const added = styleIds.filter((id) => !d.styles.includes(id));
    return added.length === 0 ? d : { ...d, styles: [...d.styles, ...added] };
  });
}

/** The draft with `visual` pinned, with `note`, unless it is pinned already. */
export function pinToDraft(visual: string, note = ""): void {
  updateDraft((d) =>
    d.pins.some((p) => p.visual === visual)
      ? d
      : { ...d, pins: [...d.pins, { id: null, visual, note }] },
  );
}

/** The workflow last chosen on this device, by its local id. */
export function lastWorkflow(): string | null {
  return storage("local")?.getItem(WORKFLOW_KEY) ?? null;
}

export function rememberWorkflow(workflow: string): void {
  storage("local")?.setItem(WORKFLOW_KEY, workflow);
}
