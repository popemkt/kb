/**
 * The outline's triggers in a row's text (DESIGN-UI.md → Triggers in the
 * text), beside the `[[` every text has: `@` a date or a node, `#` a tag,
 * `>` a field, `/` a command. `#` and `>` are the Add tag and Add field
 * steps opened from the text, so they offer and write exactly what those
 * steps do; `@` is `[[`'s nodes with the date its query names first, and
 * as a row's whole text it is Turn into reference…'s step; `/` is the node
 * menu (`slashTrigger`).
 */
import { parseDateInput, parseDay, present } from "@kb/model";
import {
  browserHost,
  dateTarget,
  datesLead,
  instanceAncestorIds,
  isProjectedRow,
  nodeCandidates,
  type NodeMap,
  type OpenTrigger,
  type PaletteStep,
  type PickerRow,
  pickerRows,
  refTrigger,
  type SchemaIndex,
  type TextTrigger,
  textOr,
  type TriggerPick,
} from "@kb/ui-sdk";
import { longDateLabel, relativeDateLabel, todayLocal } from "./date-display";
import { outlineNodes, useOutlineStore } from "./outline.store";
import { addField, addTag, OUTLINE_STEPS } from "./outline-steps";
import { slashTrigger } from "./slash-trigger";
import { landInFieldsOf } from "./value-slot-nav";

/** How many rows a trigger's picker shows. */
const LIMIT = 12;

/** `opener` at the start of the text or after a space, and the query typed after it. */
function openedAfterSpace(opener: string, query: string) {
  const pattern = new RegExp(`(^|\\s)${opener}(${query})$`, "u");
  return (text: string, cursor: number) => {
    const match = pattern.exec(text.slice(0, cursor));
    if (match === null) return null;
    const start = match.index + (match[1] ?? "").length;
    return { start, end: cursor, query: match[2] ?? "" };
  };
}

/**
 * Where a palette step writes, read when picked. A conversion consumes the
 * source row in the same batch and moves focus when the batch lands.
 */
interface StepTarget<Result> {
  readonly nodeId: string;
  readonly conversion?: {
    readonly remove: () => Promise<boolean>;
    readonly land: (result: Result) => void;
    readonly refused: () => void;
  };
}

/**
 * The pick of `picked` in `step`, opened from the text of `row`, to the
 * node `at` names. Where the row stays, the trigger goes from the text and
 * the step's commit is the pick's write, made with the text's as one write
 * (`TriggerPick`). A conversion consumes the row instead: the commit and
 * the row's removal are one write, and focus moves once it lands, or stays
 * on the line when it is refused.
 */
function stepPick<Result>(
  step: PaletteStep<Result | null>,
  row: { readonly schema: SchemaIndex },
  at: StepTarget<Result>,
  picked: { readonly id: string; readonly creating: boolean; readonly name: string },
): TriggerPick {
  const commit = () =>
    step.commit({
      targetNodeId: at.nodeId,
      targetNodeIds: [at.nodeId],
      schema: row.schema,
      pickedId: picked.id,
      creating: picked.creating,
      name: picked.name,
      alternate: false,
    });
  const conversion = at.conversion;
  if (conversion === undefined) return { insert: "", write: commit };
  return {
    consume: async () => {
      const landed = await browserHost().writes.together(async () => {
        const result = await commit();
        return result === null || !(await conversion.remove()) ? null : result;
      });
      if (landed === null) conversion.refused();
      else conversion.land(landed);
    },
  };
}

/**
 * A palette step opened from the text of `row`: a pick commits to the node
 * `target` names (the row, unless it says otherwise), editing the trigger's
 * span or consuming the row (`stepPick`).
 */
function stepTrigger<Result>(
  id: string,
  step: PaletteStep<Result | null>,
  open: TextTrigger["open"],
  row: { readonly nodeId: string; readonly schema: SchemaIndex },
  target: (typed: { readonly query: string }) => StepTarget<Result> | null = () => ({
    nodeId: row.nodeId,
  }),
): TextTrigger {
  return {
    id,
    open,
    rows: (query, nodes) =>
      pickerRows(
        step.candidates({
          nodes,
          wireNodes: browserHost().graph.state().wireNodes,
          anchorId: row.nodeId,
          targetNodeIds: [row.nodeId],
        }),
        { query, canCreate: step.createLabel !== undefined, limit: step.limit ?? LIMIT },
      ),
    ...(step.createLabel === undefined ? {} : { createLabel: step.createLabel }),
    pick: (picked, typed) => {
      const at = target(typed);
      return at === null
        ? null
        : stepPick(step, row, at, {
            id: picked.id,
            creating: picked.kind === "create",
            name: typed.query.trim(),
          });
    },
  };
}

/** The id a date row carries: the date, after a prefix no node id has. */
const DATE_ROW = "@date:";

/** The date `query` names, read as a date field's slot reads it, as a row, when dates lead somewhere. */
function dateRow(query: string): PickerRow[] {
  const iso = datesLead() ? parseDateInput(query, todayLocal()) : null;
  const day = iso === null ? null : parseDay(iso);
  if (iso === null || day === null) return [];
  return [
    {
      kind: "item",
      id: `${DATE_ROW}${iso}`,
      label: longDateLabel(day),
      note: relativeDateLabel(day),
      disabled: false,
      matches: [],
      selected: false,
    },
  ];
}

/** Where `@` opens: its query may run to a few words ("next fri"), never past two spaces. */
const mentionAt = openedAfterSpace("@", "[^\\s@][^\\n@]{0,39}|");

/** `nodeId` and every node above it in `nodes`, nearest first. */
function selfAndAbove(nodes: NodeMap, nodeId: string): Set<string> {
  const held = new Set<string>();
  let id: string | null = nodeId;
  while (id !== null && !held.has(id)) {
    held.add(id);
    id = nodes.get(id)?.parentId ?? null;
  }
  return held;
}

/** Whether an `@` query reads as one: it runs to a few words, never past two spaces. */
const mentionQuery = (open: OpenTrigger | null): OpenTrigger | null =>
  open === null || /\s\s$/u.test(open.query) ? null : open;

/**
 * What `@` offers in the text of node `nodeId`: the date its query names,
 * then the nodes `[[` offers, less the node, whose text holds the query,
 * and every node it sits under.
 */
function mentionRows(nodeId: string): TextTrigger["rows"] {
  return (query, nodes) => {
    const date = dateRow(query);
    const own = selfAndAbove(nodes, nodeId);
    const others = nodeCandidates(nodes, { exclude: (id) => own.has(id) });
    return [...date, ...pickerRows(others, { query, limit: LIMIT - date.length })];
  };
}

/**
 * The node an `@` row names: the node itself, or the date's (its day,
 * made if need be, through `ui.date-target`); null when the date leads
 * nowhere after all.
 */
async function mentioned(row: PickerRow): Promise<PickerRow | null> {
  if (!row.id.startsWith(DATE_ROW) || row.kind !== "item") return row;
  const id = await dateTarget(row.id.slice(DATE_ROW.length));
  if (id === null) return null;
  return { ...row, id, label: textOr(outlineNodes().get(id)?.text.trim(), row.label) };
}

/**
 * `@` in the text of node `nodeId`, after other text: a reference to the
 * node or the date picked, as `[[` makes, in the text.
 */
const mentionTrigger = (nodeId: string): TextTrigger => ({
  id: "mention",
  open: (text, cursor) => mentionQuery(mentionAt(text, cursor)),
  rows: mentionRows(nodeId),
  pick: async (row, typed) => {
    const target = await mentioned(row);
    // The date leads nowhere: the text stays as typed.
    return target === null ? { insert: `@${typed.query}` } : refTrigger.pick(target, typed);
  },
});

/** Turn into reference…'s step, the outline's own (`outline.add-ref`). */
const turnIntoReference = present(
  OUTLINE_STEPS.find(({ id }) => id === "add-ref")?.value,
  "the outline's add-ref step",
);

/**
 * `@` as the whole text of row `row.nodeId`, drawn at `instanceKey`, the
 * caret at its end, where the row's text is its own (not a reference's):
 * what `@` offers, and a pick makes the row a reference to it, the write
 * Turn into reference… makes, with the text gone, as one write. The row is
 * then selected, not edited: its text is now the node it references, which
 * the caret should not walk into unasked.
 */
function referenceTrigger(
  row: { readonly nodeId: string; readonly textNodeId: string; readonly schema: SchemaIndex },
  instanceKey: string | undefined,
): TextTrigger {
  return {
    id: "reference",
    open: (text, cursor) => {
      const whole = /^@[^\n@]*$/u.test(text) && cursor === text.length;
      const open = whole && row.nodeId === row.textNodeId ? mentionAt(text, cursor) : null;
      return open?.start === 0 ? mentionQuery(open) : null;
    },
    rows: mentionRows(row.nodeId),
    pick: async (picked, typed) => {
      const target = await mentioned(picked);
      if (target === null) return { insert: `@${typed.query}` };
      const pick = stepPick(
        turnIntoReference,
        row,
        { nodeId: row.nodeId },
        { id: target.id, creating: false, name: typed.query.trim() },
      );
      return { ...pick, landed: () => browserHost().selectNode(row.nodeId, instanceKey) };
    },
  };
}

/**
 * The node row `nodeId`, drawn at `instanceKey`, is an empty line of: the
 * node it is drawn under, when that is its parent and the row holds nothing
 * but its text (no child, no field, no tag). Null when it is not one.
 */
function emptyLineOf(nodeId: string, instanceKey: string | undefined): string | null {
  const node = outlineNodes().get(nodeId);
  if (node === undefined || instanceKey === undefined || isProjectedRow(instanceKey)) return null;
  // The key ends with the row's own node: a reference row's is the reference, not its target.
  if (!instanceKey.endsWith(`/${nodeId}`)) return null;
  const above = instanceAncestorIds(instanceKey).at(-1) ?? null;
  const empty = node.children.length === 0 && Object.keys(node.props).length === 0;
  return empty && above !== null && above === node.parentId ? above : null;
}

/**
 * `>` on an empty line, as a field's name begins (Tana's): it and the name
 * are the row's whole text, the caret at its end. A pick makes the line a
 * field of the node it is under: the line goes, the field is added to that
 * node in the same write, and the caret lands in the field's value where
 * that node's fields are drawn.
 */
function fieldTrigger(
  row: { readonly nodeId: string; readonly schema: SchemaIndex },
  instanceKey: string | undefined,
): TextTrigger {
  const open: TextTrigger["open"] = (text, cursor) => {
    const match = /^>([^\s>][^\n]*|)$/u.exec(text);
    return match === null || cursor !== text.length || emptyLineOf(row.nodeId, instanceKey) === null
      ? null
      : { start: 0, end: cursor, query: match[1] ?? "" };
  };
  return stepTrigger("field", addField, open, row, (typed) => {
    const parent = emptyLineOf(row.nodeId, instanceKey);
    if (parent === null || instanceKey === undefined) return null;
    const text = `>${typed.query}`;
    const land = landInFieldsOf(instanceKey, parent);
    const focusIsFree = () => {
      const { activeInstanceKey, selectedInstanceKey } = useOutlineStore.getState();
      const focused = document.activeElement;
      return (
        activeInstanceKey === instanceKey ||
        (selectedInstanceKey === null &&
          (focused === document.body || focused?.isConnected !== true))
      );
    };
    return {
      nodeId: parent,
      conversion: {
        remove: () => browserHost().writes.deleteNode(row.nodeId, { parent, text }),
        land: (fieldId) => {
          if (focusIsFree()) land(fieldId);
        },
        refused: () => {
          if (focusIsFree() && outlineNodes().get(row.nodeId)?.parentId === parent) {
            useOutlineStore.getState().activateNode(row.nodeId, text.length, instanceKey);
          }
        },
      },
    };
  });
}

/**
 * The outline's triggers for the text of the row whose node is `rowNodeId`,
 * its text node `nodeId`'s (`shownNodeId`: the row's own, or a reference's
 * target), drawn at `instanceKey`, beside every text's `[[`. The first that
 * opens is the one open, so `@` as the whole text is a reference row's
 * before it is a mention.
 */
export function outlineTriggers(
  rowNodeId: string,
  nodeId: string,
  instanceKey: string | undefined,
  schema: SchemaIndex,
): readonly TextTrigger[] {
  const row = { nodeId, schema };
  return [
    referenceTrigger({ nodeId: rowNodeId, textNodeId: nodeId, schema }, instanceKey),
    mentionTrigger(nodeId),
    stepTrigger("tag", addTag, openedAfterSpace("#", "[^\\s#]*"), row),
    fieldTrigger(row, instanceKey),
    slashTrigger(rowNodeId, openedAfterSpace("/", "[^\\s/]*")),
  ];
}
