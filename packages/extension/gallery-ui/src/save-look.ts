/**
 * Saving the draft as a `#look` node: the plan of core writes from what is
 * saved to what the draft says (`lookWrites`), run in order through the
 * page's one invoke path. A new look is written first and its pins after,
 * under its id; the draft then names what is saved, pins and all. A save
 * asked for while one runs joins it.
 */
import { lookOf, lookWrites, nameOf, type GraphNode, type LookDraft } from "@kb/gallery";
import { browserHost, toast } from "@kb/ui-sdk";
import { addNode } from "./add-node";
import { currentDraft, updateDraft } from "./draft";

async function run(
  writes: ReturnType<typeof lookWrites>,
): Promise<{ readonly ok: boolean; readonly added: ReadonlyMap<number, string> }> {
  const added = new Map<number, string>();
  for (const write of writes) {
    // In order: a pin's parent is the look, so each write waits for the one before it.
    if (write.id === "node.add") {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the writes depend on one another's order
      const id = await addNode(write.input, "Could not save the look");
      if (id === null) return { ok: false, added };
      added.set(write.pin ?? -1, id);
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the writes depend on one another's order
    const receipt = await browserHost().invoke(write.id, write.input);
    if (receipt.status === "failed") {
      toast(`Could not save the look: ${receipt.message}`);
      return { ok: false, added };
    }
  }
  return { ok: true, added };
}

async function saveNow(
  saveInto: string | null,
  node: (id: string) => GraphNode | undefined,
): Promise<string | null> {
  const draft = currentDraft();
  const savedNode = draft.id === null ? undefined : node(draft.id);
  const saved = savedNode === undefined ? null : lookOf(savedNode, node);
  // A look saved once and gone since is made again, and every pin with it.
  const asked: LookDraft =
    saved === null
      ? { ...draft, id: null, pins: draft.pins.map((p) => ({ ...p, id: null })) }
      : draft;
  let lookId = saved === null ? null : draft.id;
  if (lookId === null) {
    const made = await run(lookWrites(asked, null, saveInto));
    lookId = made.added.get(-1) ?? null;
    if (!made.ok || lookId === null) return null;
  }
  const asSaved: LookDraft = saved ?? { ...asked, id: lookId, pins: [] };
  const rest = await run(lookWrites({ ...asked, id: lookId }, asSaved, saveInto));
  // The pins just written, by the visual they stand for: the draft may have moved on meanwhile.
  const pinIds = new Map<string, string>();
  asked.pins.forEach((pin, i) => {
    const id = rest.added.get(i);
    if (pin.id === null && id !== undefined) pinIds.set(pin.visual, id);
  });
  updateDraft((d) => ({
    ...d,
    id: lookId,
    pins: d.pins.map((pin) => {
      const id = pinIds.get(pin.visual);
      if (id !== undefined) return { ...pin, id };
      return saved === null ? { ...pin, id: null } : pin;
    }),
  }));
  if (rest.ok) toast(`Saved the look “${nameOf(draft)}”`);
  return rest.ok ? lookId : null;
}

/** The save running now, which a second ask joins rather than adding the look twice. */
let inFlight: Promise<string | null> | null = null;

/** Save the draft; answers the look's id, or null after saying why not. */
export function saveLook(
  saveInto: string | null,
  node: (id: string) => GraphNode | undefined,
): Promise<string | null> {
  inFlight ??= saveNow(saveInto, node).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
