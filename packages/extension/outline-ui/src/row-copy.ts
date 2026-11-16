/**
 * Rows leaving as text another program reads (DESIGN-UI.md → Outline
 * editor, "Copy, cut and Copy as…"): the flavours a copy of rows puts,
 * written by the outline formats' codecs over the projection of the rows,
 * and the page's copy and cut of the selected rows.
 */
import { useEffect } from "react";
import {
  EXPORT_DEFAULTS,
  exportOutline,
  type ExportOptions,
  type OutlineGraph,
} from "@kb/outline-paste";
import { browserHost, putFlavours, type ClipboardFlavours, type SchemaIndex } from "@kb/ui-sdk";
import { useOutlineStore } from "./outline.store";
import { KB_OUTLINE_TYPE } from "./outline-paste";
import { applySelectionAction } from "./selection-actions";
import { ownsItsKeys } from "./selection-keymap";

/** The whole graph, as the projection reads it: a node, and the parent its row sits under. */
const graphOf = (schema: SchemaIndex): OutlineGraph => ({
  nodeOf: (id) => schema.get(id),
  parentOf: (id) => schema.get(id)?.parentId,
});

/**
 * What a copy of `rows` as `choice` puts: Rich text puts its HTML with the
 * Markdown of the same choice as `text/plain`, so a plain editor still gets
 * text; every other format puts its text as `text/plain`.
 */
export function copyFlavours(
  rows: readonly string[],
  schema: SchemaIndex,
  choice: ExportOptions,
): ClipboardFlavours {
  const written = (format: ExportOptions["format"]) =>
    exportOutline(rows, graphOf(schema), { ...choice, format }).text;
  return choice.format === "html"
    ? { "text/plain": written("md"), "text/html": written("html") }
    : { "text/plain": written(choice.format) };
}

/**
 * What the page's copy of `rows` puts: Markdown and Rich text with
 * `EXPORT_DEFAULTS`, never the remembered Copy as… choice, so a copy is the
 * same every time; and kb's own flavour, the rows as JSON written as the
 * source, which a paste into kb reads back losslessly.
 */
function rowFlavours(rows: readonly string[], schema: SchemaIndex): ClipboardFlavours {
  const source = { ...EXPORT_DEFAULTS, format: "json", refs: "id" } as const;
  return {
    ...copyFlavours(rows, schema, { ...EXPORT_DEFAULTS, format: "html" }),
    [KB_OUTLINE_TYPE]: exportOutline(rows, graphOf(schema), source).text,
  };
}

/** The row block a DOM position sits in, if any. */
const blockOf = (node: Node): HTMLElement | null =>
  (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
    "[data-node-block]",
  ) ?? null;

/** The node ids of the rows a native selection runs across, first to last as drawn; none within one row. */
function rowsAcross(selection: Selection | null): string[] {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  const first = blockOf(range.startContainer);
  const last = blockOf(range.endContainer);
  if (first === null || last === null || first === last) return [];
  const blocks = [...document.querySelectorAll<HTMLElement>("[data-node-block]")];
  const from = blocks.indexOf(first);
  const to = blocks.indexOf(last);
  return blocks.slice(from, to + 1).flatMap((block) => {
    const id = block.dataset.nodeId;
    return id === undefined ? [] : [id];
  });
}

/**
 * The page's copy and cut while rows are about: the selected rows while no
 * text is selected and no row is edited, else the rows a native selection
 * runs across. It answers the event itself, since only a copy event may
 * set several flavours and a custom one. A cut is that copy, then the
 * selection's Delete.
 */
export function useRowCopy(): void {
  useEffect(() => {
    const onCopy = (cut: boolean) => (e: ClipboardEvent) => {
      if (e.defaultPrevented || e.clipboardData === null || ownsItsKeys(e.target)) return;
      const store = useOutlineStore.getState();
      const selection = document.getSelection();
      const selected =
        store.activeNodeId === null && (selection === null || selection.isCollapsed)
          ? store.selectedNodeIds
          : [];
      const rows = selected.length > 0 ? selected : rowsAcross(selection);
      if (rows.length === 0) return;
      putFlavours(e.clipboardData, rowFlavours(rows, browserHost().schema()));
      e.preventDefault();
      const head = store.selectedNodeId;
      const instanceKey = store.selectedInstanceKey;
      if (cut && selected.length > 0 && head !== null && instanceKey !== null) {
        applySelectionAction({ type: "delete", nodeId: head, instanceKey });
      }
    };
    const copy = onCopy(false);
    const cut = onCopy(true);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
    };
  }, []);
}
