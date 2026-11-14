/**
 * The outline's triggers in a row's text (DESIGN-UI.md → Triggers in the
 * text), beside the `[[` every text has: `@` a date or a node, `#` a tag,
 * `>` a field. `#` and `>` are the Add tag and Add field steps opened from
 * the text, so they offer and write exactly what those steps do; `@` is
 * `[[`'s nodes with the date its query names first.
 */
import { parseDateInput, parseDay } from "@kb/model";
import {
  browserHost,
  dateTarget,
  datesLead,
  nodeCandidates,
  type PaletteStep,
  type PickerRow,
  pickerRows,
  refTrigger,
  type SchemaIndex,
  type TextTrigger,
  textOr,
} from "@kb/ui-sdk";
import { longDateLabel, relativeDateLabel, todayLocal } from "./date-display";
import { outlineNodes } from "./outline.store";
import { addField, addTag } from "./outline-steps";
import { enterFields } from "./value-slot-nav";

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
 * A palette step opened from the text: a pick takes the trigger out of the
 * text, then commits.
 *
 * GAP [[01M7D4AYQFJGZQGJZ3KD7M388R]] — the text's write and the step's are
 * two writes, so one undo takes back the step's alone.
 */
function stepTrigger(
  id: string,
  step: PaletteStep,
  open: TextTrigger["open"],
  row: { readonly nodeId: string; readonly schema: SchemaIndex },
  then?: () => void,
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
    pick: (picked, typed) => ({
      insert: "",
      write: async () => {
        await step.commit({
          targetNodeId: row.nodeId,
          targetNodeIds: [row.nodeId],
          schema: row.schema,
          pickedId: picked.id,
          creating: picked.kind === "create",
          name: typed.query.trim(),
          alternate: false,
        });
        then?.();
      },
    }),
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

/**
 * `@` in the text of row `nodeId`: a reference to the date its query names
 * (its day, made if need be, through `ui.date-target`), else to a node, as
 * `[[` makes. The row itself is not offered: its text holds the query.
 */
const mentionTrigger = (nodeId: string): TextTrigger => ({
  id: "mention",
  open: (text, cursor) => {
    const open = mentionAt(text, cursor);
    return open === null || /\s\s$/u.test(open.query) ? null : open;
  },
  rows: (query, nodes) => {
    const date = dateRow(query);
    const others = nodeCandidates(nodes, { exclude: (id) => id === nodeId });
    return [...date, ...pickerRows(others, { query, limit: LIMIT - date.length })];
  },
  pick: async (row, typed) => {
    if (!row.id.startsWith(DATE_ROW) || row.kind !== "item") return refTrigger.pick(row, typed);
    const id = await dateTarget(row.id.slice(DATE_ROW.length));
    // The date leads nowhere after all: the text stays as typed.
    if (id === null) return { insert: `@${typed.query}` };
    const label = textOr(outlineNodes().get(id)?.text.trim(), row.label);
    return refTrigger.pick({ ...row, id, label }, typed);
  },
});

/** `>`: it and a field's name are the row's whole text, the caret at its end. */
const fieldOpen: TextTrigger["open"] = (text, cursor) => {
  const match = /^>([^\s>][^\n]*|)$/u.exec(text);
  return match === null || cursor !== text.length
    ? null
    : { start: 0, end: cursor, query: match[1] ?? "" };
};

/**
 * The outline's triggers for the text of row `nodeId` (the node its text
 * is: `shownNodeId`), drawn at `instanceKey`, beside every text's `[[`.
 */
export function outlineTriggers(
  nodeId: string,
  instanceKey: string | undefined,
  schema: SchemaIndex,
): readonly TextTrigger[] {
  const row = { nodeId, schema };
  return [
    mentionTrigger(nodeId),
    stepTrigger("tag", addTag, openedAfterSpace("#", "[^\\s#]*"), row),
    // The field added, the caret goes into its value, as Tab into a row's fields does.
    stepTrigger("field", addField, fieldOpen, row, () => {
      if (instanceKey !== undefined) enterFields(instanceKey, "last");
    }),
  ];
}
