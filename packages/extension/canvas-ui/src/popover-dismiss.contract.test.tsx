/**
 * The canvas's popovers, each run through the dismiss contract
 * (`dismissContract`, DESIGN-UI.md → Cross-surface polish → Popovers dismiss
 * one way): a comment thread's panel, the solid picker, the view menu, the
 * command menus (context, zoom), the shortcuts sheet and the node picker.
 */
import { useState } from "react";
import { afterAll, beforeAll } from "vitest";
import { TIMING_FALLBACK, syncUiPlugins } from "@kb/ui-sdk";
import {
  UntilDismissed,
  dismissContract,
  renderPopover,
  testBrowserHost,
  testHostPlugin,
} from "@kb/ui-test-kit";
import { viewOfPan } from "./canvas-camera";
import { CanvasCameraRig } from "./canvas-camera-rig";
import { CommentThreadPanel } from "./canvas-comment-thread";
import { CanvasContextMenu } from "./canvas-context-menu";
import { EMPTY_SELECTION } from "./canvas-selection";
import { CanvasShortcutsSheet } from "./canvas-shortcuts-sheet";
import { CanvasToolbar } from "./canvas-toolbar";
import { CanvasToolSheet } from "./canvas-tool-sheet";
import { CanvasViewWidget } from "./canvas-view-widget";
import { CanvasZoomMenu } from "./canvas-zoom-menu";
import { NodePicker } from "./node-picker";

// The node picker lists the page's nodes through its host: here, a test host.
beforeAll(() => syncUiPlugins([testHostPlugin(testBrowserHost())]));
afterAll(() => syncUiPlugins([]));

const noop = () => {};
const find = (selector: string) => () => document.querySelector(selector);
const flat = viewOfPan({ x: 0, y: 0 }, 1, { width: 800, height: 600 });
const trigger = (selector: string) => () => document.querySelector<HTMLElement>(selector);

/** The view widget as the canvas holds it: its menu closed until its button opens it. */
function ViewWidget() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <CanvasViewWidget
      rig={new CanvasCameraRig(flat, TIMING_FALLBACK, true)}
      in3d={false}
      pan={{ x: 0, y: 0 }}
      zoom={1}
      width={800}
      height={600}
      projection="2d"
      selectionEmpty
      frames={[]}
      menuOpen={menuOpen}
      onMenuOpenChange={setMenuOpen}
      onIntent={noop}
      compact={false}
    />
  );
}

dismissContract({
  "packages/extension/canvas-ui/src/canvas-comment-thread.tsx": (host) =>
    renderPopover(
      host,
      <UntilDismissed>
        {(dismiss) => (
          <CommentThreadPanel
            thread={null}
            on="a point"
            target={[{ left: 200, top: 100, right: 200, bottom: 100 }]}
            stage={{ width: 800, height: 600 }}
            onClose={dismiss}
            onPost={async () => null}
            onResolve={async () => null}
          />
        )}
      </UntilDismissed>,
      find('[data-testid="comment-panel"]'),
      null,
    ),
  "packages/extension/canvas-ui/src/canvas-toolbar.tsx": (host) =>
    renderPopover(
      host,
      <CanvasToolbar
        compact={false}
        projection="3d"
        onProjectionChange={noop}
        toolState={{ tool: "select" }}
        onToolChange={noop}
        onToolDoubleClick={noop}
      />,
      find('[data-testid="canvas-solid-picker"]'),
      trigger('[data-tool="box"]'),
    ),
  "packages/extension/canvas-ui/src/canvas-tool-sheet.tsx": (host) =>
    renderPopover(
      host,
      <CanvasToolSheet
        projection="2d"
        onProjectionChange={noop}
        toolState={{ tool: "select" }}
        onToolChange={noop}
        onToolDoubleClick={noop}
      />,
      find('[data-testid="canvas-tool-sheet"]'),
      trigger('button[aria-label="More tools"]'),
    ),
  "packages/extension/canvas-ui/src/canvas-view-widget.tsx": (host) =>
    renderPopover(
      host,
      <ViewWidget />,
      find('[data-testid="canvas-view-menu"]'),
      trigger('button[aria-haspopup="menu"]'),
    ),
  // The command menus (context, zoom) dismiss through the one CommandMenu: the zoom menu opens from its button.
  "packages/extension/canvas-ui/src/canvas-menu.tsx": (host) =>
    renderPopover(
      host,
      <CanvasZoomMenu zoom={1} selection={EMPTY_SELECTION} byId={new Map()} onIntent={noop} />,
      find('[data-testid="canvas-zoom-menu"]'),
      trigger('button[title="Zoom"]'),
    ),
  "packages/extension/canvas-ui/src/canvas-shortcuts-sheet.tsx": (host) =>
    renderPopover(
      host,
      <UntilDismissed>
        {(dismiss) => <CanvasShortcutsSheet open onClose={dismiss} />}
      </UntilDismissed>,
      find('[data-testid="canvas-shortcuts"]'),
      null,
    ),
  "packages/extension/canvas-ui/src/node-picker.tsx": (host) =>
    renderPopover(
      host,
      <UntilDismissed>
        {(dismiss) => <NodePicker onPick={noop} onClose={dismiss} />}
      </UntilDismissed>,
      find('input[placeholder="Add existing node…"]'),
      null,
    ),
});

// The same CommandMenu opened by a right-click: no trigger, so a press anywhere outside shuts it.
dismissContract({
  "packages/extension/canvas-ui/src/canvas-menu.tsx": (host) =>
    renderPopover(
      host,
      <UntilDismissed>
        {(dismiss) => (
          <CanvasContextMenu
            at={{ x: 10, y: 10 }}
            selection={EMPTY_SELECTION}
            byId={new Map()}
            onIntent={noop}
            onClose={dismiss}
          />
        )}
      </UntilDismissed>,
      find('[data-testid="canvas-context-menu"]'),
      null,
    ),
});
