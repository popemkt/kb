/**
 * `/` in a row's text (DESIGN-UI.md → Triggers in the text): the node
 * menu's commands for the row, as the node palette lists them, run from the
 * text. The list is the host's (`BrowserHost.nodeCommands`), the one query
 * over the command registry, so `/` offers what ⌘K offers and nothing else.
 */
import {
  browserHost,
  type CommandTarget,
  keepEditing,
  type NodeCommandListing,
  type PaletteSurface,
  pickerRows,
  type TextTrigger,
} from "@kb/ui-sdk";

/**
 * The palette a command picked from the text runs from. There is no list to
 * close; a step opens in the node palette, on the row being edited.
 */
const FROM_TEXT: PaletteSurface = {
  close: () => {},
  openStep: (step) => browserHost().setNodePaletteOpen(true, step),
};

/** The node menu of row `nodeId`, in its order. */
function commandsOf(nodeId: string): readonly NodeCommandListing[] {
  const target: CommandTarget = { nodeId, frameId: nodeId, nodeIds: [nodeId] };
  return browserHost().nodeCommands(target, FROM_TEXT);
}

/**
 * `/` in the text of row `row.nodeId` (its text node `row.textNodeId`'s),
 * drawn at `instanceKey`, opening where `open` says: the row's commands,
 * matched by their labels. A pick consumes what was typed for it: `/` and
 * the query go from the text as typing takes text away, then the command
 * runs about the row through the page's write path (`PageWrites.together`),
 * so what it writes, once it answers, is one undo step, and its undo leaves
 * the text as the pick left it. The row is still edited after it, where `/`
 * was (`keepEditing`).
 */
export function slashTrigger(
  row: { readonly nodeId: string; readonly textNodeId: string },
  instanceKey: string | undefined,
  open: TextTrigger["open"],
): TextTrigger {
  return {
    id: "command",
    open,
    rows: (query) =>
      pickerRows(
        commandsOf(row.nodeId).map(({ id, label }) => ({ id, label })),
        { query },
      ),
    pick: (picked, typed) => {
      const command = commandsOf(row.nodeId).find(({ id }) => id === picked.id);
      if (command === undefined) return null;
      return {
        consume: async () => {
          const host = browserHost();
          const text = host.node(row.textNodeId)?.text ?? "";
          const left = text.slice(0, typed.start) + text.slice(typed.end);
          await host.writes.updateNodeContent(row.textNodeId, left);
          // The editor takes the text as written, the caret where `/` was.
          host.activateNode(row.nodeId, typed.start, instanceKey);
          // GAP [[01M7XSNFCYHHYD7VKTZXPYG60B]] a command that does not answer its writes makes them apart.
          // GAP [[01M7XVRNAJBC9Q09SKCGRQTMHC]] the gesture is the page's: an edit made while it is open joins it.
          await host.writes.together(command.run);
          keepEditing(row.nodeId, typed.start);
        },
      };
    },
  };
}
