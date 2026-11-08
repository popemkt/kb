/**
 * Writing a backdrop's knobs from the studio (DESIGN-UI.md → Backdrop
 * Studio): a value is a setting on its holder's node (`knobFieldId`), so it
 * is written as any setting is, through the page's writes, and undone as
 * one. A control's moves are drafts, shown at once and written nowhere;
 * the value it settles on (`KnobControl`'s `onCommit`: a slider let go, a
 * field left) is the one write, so a drag is one write and one undo
 * however long it rests on the way.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { knobFieldId, knobPropValue, type Knob, type KnobValue, type NodeId } from "@kb/model";
import { browserHost } from "@kb/ui-sdk";

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

interface Draft {
  readonly holder: NodeId;
  readonly knob: Knob;
  readonly value: KnobValue;
}

const without = <V>(record: Readonly<Record<NodeId, V>>, field: NodeId) => {
  if (!(field in record)) return record;
  const { [field]: _gone, ...rest } = record;
  return rest;
};

/**
 * The values moved and not yet settled, by field (`drafts`); `move`, which
 * shows a value at once; `settle`, which writes it; and `reset`, which
 * drops a draft and takes the value out. A draft still unsettled when the
 * studio closes (a field typed in and never left) is written then.
 */
export function useKnobDrafts(): {
  readonly drafts: Readonly<Record<NodeId, KnobValue>>;
  readonly move: (holder: NodeId, knob: Knob, value: KnobValue) => void;
  readonly settle: (holder: NodeId, knob: Knob, value: KnobValue) => void;
  readonly reset: (holder: NodeId, knob: Knob) => void;
} {
  const [drafts, setDrafts] = useState<Readonly<Record<NodeId, KnobValue>>>({});
  const unsettled = useRef(new Map<NodeId, Draft>());
  useEffect(() => {
    const open = unsettled.current;
    return () => {
      for (const { holder, knob, value } of open.values()) void writeKnob(holder, knob, value);
      open.clear();
    };
  }, []);
  const move = useCallback((holder: NodeId, knob: Knob, value: KnobValue) => {
    const field = knobFieldId(holder, knob.id);
    unsettled.current.set(field, { holder, knob, value });
    setDrafts((current) => ({ ...current, [field]: value }));
  }, []);
  const settle = useCallback((holder: NodeId, knob: Knob, value: KnobValue) => {
    const field = knobFieldId(holder, knob.id);
    unsettled.current.delete(field);
    setDrafts((current) => ({ ...current, [field]: value }));
    // The draft stays until the write lands, so the control never shows the old value between.
    void writeKnob(holder, knob, value).finally(() =>
      setDrafts((current) => (current[field] === value ? without(current, field) : current)),
    );
  }, []);
  const reset = useCallback((holder: NodeId, knob: Knob) => {
    const field = knobFieldId(holder, knob.id);
    unsettled.current.delete(field);
    setDrafts((current) => without(current, field));
    void resetKnob(holder, knob);
  }, []);
  return { drafts, move, settle, reset };
}
