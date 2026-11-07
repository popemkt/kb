/**
 * Writing a backdrop's knobs from the studio (DESIGN-UI.md → Backdrop
 * Studio): a value is a setting on its holder's node (`knobFieldId`), so it
 * is written as any setting is, through the page's writes, and undone as
 * one. A control that moves continuously (a slider dragged) settles first,
 * so a drag is one write, and one undo, not one per frame.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { knobFieldId, knobPropValue, type Knob, type KnobValue, type NodeId } from "@kb/model";
import { browserHost } from "@kb/ui-sdk";

/** How long a knob rests before its value is written. */
const SETTLE_MS = 150;

/** Write `value` of `knob` to its field on `holder`; a value it holds none for (a seed each load) takes it out. */
function writeKnob(holder: NodeId, knob: Knob, value: KnobValue): Promise<void> {
  const field = knobFieldId(holder, knob.id);
  const host = browserHost();
  const held = host.node(holder)?.props[field]?.[0];
  const next = knobPropValue(knob, field, value);
  if (next === null) return held === undefined ? Promise.resolve() : resetKnob(holder, knob);
  return host.writes.updateProp(holder, field, next, held);
}

/** Take `knob`'s value off `holder`, where it holds one: it reads as its default again. */
function resetKnob(holder: NodeId, knob: Knob): Promise<void> {
  const field = knobFieldId(holder, knob.id);
  const host = browserHost();
  if (host.node(holder)?.props[field] === undefined) return Promise.resolve();
  return host.writes.removeProp(holder, field);
}

/**
 * The values being set and not yet written, by field; `set`, which shows a
 * value at once and writes it once it settles; and `reset`, which drops
 * one still settling before it takes the value out. Leaving the studio
 * writes what is still settling.
 */
export function useSettlingKnobs(): {
  readonly drafts: Readonly<Record<NodeId, KnobValue>>;
  readonly set: (holder: NodeId, knob: Knob, value: KnobValue) => void;
  readonly reset: (holder: NodeId, knob: Knob) => void;
} {
  const [drafts, setDrafts] = useState<Readonly<Record<NodeId, KnobValue>>>({});
  const pending = useRef(new Map<NodeId, { timer: number; write: () => void }>());
  useEffect(() => {
    const settling = pending.current;
    return () => {
      for (const { timer, write } of settling.values()) {
        window.clearTimeout(timer);
        write();
      }
      settling.clear();
    };
  }, []);
  const set = useCallback((holder: NodeId, knob: Knob, value: KnobValue) => {
    const field = knobFieldId(holder, knob.id);
    setDrafts((current) => ({ ...current, [field]: value }));
    const settling = pending.current;
    const before = settling.get(field);
    if (before !== undefined) window.clearTimeout(before.timer);
    const write = () => {
      settling.delete(field);
      void writeKnob(holder, knob, value).finally(() =>
        setDrafts((current) => {
          if (current[field] !== value) return current;
          const { [field]: _written, ...rest } = current;
          return rest;
        }),
      );
    };
    settling.set(field, { timer: window.setTimeout(write, SETTLE_MS), write });
  }, []);
  const reset = useCallback((holder: NodeId, knob: Knob) => {
    const field = knobFieldId(holder, knob.id);
    const before = pending.current.get(field);
    if (before !== undefined) window.clearTimeout(before.timer);
    pending.current.delete(field);
    setDrafts((current) => {
      if (!(field in current)) return current;
      const { [field]: _dropped, ...rest } = current;
      return rest;
    });
    void resetKnob(holder, knob);
  }, []);
  return { drafts, set, reset };
}
