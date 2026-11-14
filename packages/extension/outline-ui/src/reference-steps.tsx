/**
 * The steps over the references a row's text names (DESIGN-UI.md →
 * Contextual references): Expand reference… opens one in place under the
 * row, or closes it, and Remove reference… turns one back into plain text.
 * Each lists the references the text names, once each, in the order it
 * names them.
 */
import { ArrowsOutLineVerticalIcon, LinkBreakIcon } from "@phosphor-icons/react";
import { mentionSpans, replaceMentions } from "@kb/model";
import {
  browserHost,
  type NodeMap,
  type PaletteStep,
  type PickerCandidate,
  shownNode,
  textOr,
} from "@kb/ui-sdk";
import { openReferenceKey, referencesIn } from "./open-references";
import { outlineNodes, useOutlineStore } from "./outline.store";

/** What a step's candidates are drawn from. */
type StepGraph = Parameters<PaletteStep["candidates"]>[0];

/** The node whose text row `rowId` shows, and edits (`shownNode`). */
function textNodeOf(nodes: NodeMap, rowId: string | null) {
  const row = rowId === null ? undefined : nodes.get(rowId);
  return row === undefined ? undefined : shownNode(row, browserHost().schema());
}

/** How the reference to `id` in `text` reads: its target's text, else its label, else its id. */
function referenceLabel(nodes: NodeMap, text: string, id: string): string {
  const label = mentionSpans(text).find((span) => span.id === id)?.label;
  return textOr(nodes.get(id)?.text.trim(), textOr(label?.trim(), id));
}

/** The references the text of the step's row names, as rows, `note` saying what to add. */
function referenceRows(
  graph: StepGraph,
  note: (key: string) => string | undefined,
): PickerCandidate[] {
  const text = textNodeOf(graph.nodes, graph.anchorId);
  if (text === undefined) return [];
  return referencesIn(text.text).map((id) => {
    const said = note(openReferenceKey(text.id, id));
    return {
      id,
      label: referenceLabel(graph.nodes, text.text, id),
      ...(said === undefined ? {} : { note: said }),
    };
  });
}

/** Expand reference…: a pick opens the reference under its row, or closes it. */
export const expandReference: PaletteStep = {
  label: "Expand reference",
  placeholder: "Search the references this names...",
  icon: <ArrowsOutLineVerticalIcon size={12} weight="bold" />,
  candidates: (graph) =>
    referenceRows(graph, (key) =>
      useOutlineStore.getState().expansion.get(key) === true ? "Expanded" : undefined,
    ),
  commit: ({ targetNodeId, pickedId }) => {
    const text = textNodeOf(outlineNodes(), targetNodeId);
    if (text !== undefined) useOutlineStore.getState().toggleReference(text.id, pickedId);
    return Promise.resolve();
  },
};

/**
 * Remove reference…: every reference to the node picked becomes its
 * label, as plain text, in one text write.
 */
export const removeReference: PaletteStep = {
  label: "Remove reference",
  placeholder: "Search the references this names...",
  icon: <LinkBreakIcon size={12} weight="bold" />,
  candidates: (graph) => referenceRows(graph, () => undefined),
  commit: async ({ targetNodeId, pickedId }) => {
    const nodes = outlineNodes();
    const text = textNodeOf(nodes, targetNodeId);
    if (text === undefined) return;
    const label = referenceLabel(nodes, text.text, pickedId);
    const next = replaceMentions(text.text, (span) =>
      span.id === pickedId
        ? textOr(span.label?.trim(), label)
        : text.text.slice(span.start, span.end),
    );
    // A command's write, not a keystroke's: one undo step (`setNodeText`).
    await browserHost().writes.setNodeText(text.id, next);
  },
};
