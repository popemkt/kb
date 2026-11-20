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
  instanceAncestorIds,
  isProjectedRow,
  nodeCandidates,
  type NodeMap,
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
 * Where a palette step opened from the text writes, read when it is picked:
 * the node the pick is for, the writes made with the step's as the same one
 * write, and what follows once that is made.
 */
interface StepTarget {
  readonly nodeId: string;
  readonly with?: () => Promise<unknown>;
  readonly after?: () => void;
}

/**
 * A palette step opened from the text of `row`: a pick takes the trigger
 * out of the text, then commits to the node `target` names (the row, unless
 * it says otherwise), with what goes with it, as one write.
 *
 * GAP [[01M7D4AYQFJGZQGJZ3KD7M388R]] — where the row stays (`#`), the
 * text's write and the step's are two writes, so one undo takes back the
 * step's alone.
 */
function stepTrigger(
  id: string,
  step: PaletteStep,
  open: TextTrigger["open"],
  row: { readonly nodeId: string; readonly schema: SchemaIndex },
  target: () => StepTarget | null = () => ({ nodeId: row.nodeId }),
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
      const at = target();
      return {
        insert: "",
        write: async () => {
          if (at === null) return;
          await browserHost().writes.together(async () => {
            await at.with?.();
            await step.commit({
              targetNodeId: at.nodeId,
              targetNodeIds: [at.nodeId],
              schema: row.schema,
              pickedId: picked.id,
              creating: picked.kind === "create",
              name: typed.query.trim(),
              alternate: false,
            });
          });
          at.after?.();
        },
      };
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

/**
 * `@` in the text of row `nodeId`: a reference to the date its query names
 * (its day, made if need be, through `ui.date-target`), else to a node, as
 * `[[` makes. Neither the row, whose text holds the query, nor a node it
 * sits under is offered.
 */
const mentionTrigger = (nodeId: string): TextTrigger => ({
  id: "mention",
  open: (text, cursor) => {
    const open = mentionAt(text, cursor);
    return open === null || /\s\s$/u.test(open.query) ? null : open;
  },
  rows: (query, nodes) => {
    const date = dateRow(query);
    const own = selfAndAbove(nodes, nodeId);
    const others = nodeCandidates(nodes, { exclude: (id) => own.has(id) });
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
  return stepTrigger("field", addField, open, row, () => {
    const parent = emptyLineOf(row.nodeId, instanceKey);
    if (parent === null || instanceKey === undefined) return null;
    return {
      nodeId: parent,
      with: () => browserHost().writes.deleteNode(row.nodeId),
      after: landInFieldsOf(instanceKey, parent),
    };
  });
}

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
    fieldTrigger(row, instanceKey),
  ];
}
