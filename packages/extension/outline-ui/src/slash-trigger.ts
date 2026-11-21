/**
 * `/` in a row's text (DESIGN-UI.md → Triggers in the text): the node
 * menu's commands for the row, as the node palette lists them, run from the
 * text. The list is the host's (`BrowserHost.nodeCommands`), the one query
 * over the command registry, so `/` offers what ⌘K offers and nothing else.
 */
import {
  browserHost,
  type CommandTarget,
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
 * Once the page has drawn what was just written: edit row `nodeId` at
 * `caret` where it is drawn now, when nothing holds the focus. A command
 * that redraws the row (an indent puts it under another) takes its editor
 * away; one that opens something (a step in the node palette, a dialog)
 * holds the focus itself.
 *
 * GAP [[01M7X9MKS1DM5JEAR2DRWS7KT6]] a row redrawn here starts its text
 * history over, so ⌘Z in it reaches only what is typed since.
 */
function keepEditing(nodeId: string, caret: number): void {
  const resume = () => {
    const held = document.activeElement;
    if (held === null || held === document.body) browserHost().activateNode(nodeId, caret);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(resume);
  else resume();
}

/**
 * `/` in the text of the row whose node is `nodeId`, opening where `open`
 * says: the row's commands, matched by their labels. A pick takes `/` and
 * the query out of the text and runs the command about the row, with the
 * text's write, as one write; the row is still edited after it, where `/`
 * was (`keepEditing`).
 */
export function slashTrigger(nodeId: string, open: TextTrigger["open"]): TextTrigger {
  return {
    id: "command",
    open,
    rows: (query) =>
      pickerRows(
        commandsOf(nodeId).map(({ id, label }) => ({ id, label })),
        { query },
      ),
    pick: (picked, typed) => ({
      insert: "",
      // A command plans its writes as it runs, so they join the pick's one write.
      // GAP [[01M7X8ATCXT6TBS4YVGAT7P746]] its listing answers no promise to wait for.
      write: () => {
        void commandsOf(nodeId)
          .find((command) => command.id === picked.id)
          ?.run();
        return Promise.resolve();
      },
      landed: () => keepEditing(nodeId, typed.start),
    }),
  };
}
