import { memo, useCallback } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import {
  browserHost,
  Bullet,
  bulletClickIntent,
  cn,
  guideLineStyle,
  indentStyle,
  NodeRow,
  nodeTarget,
  outlineInstanceKey,
  type OutlineNode,
  resolveRowChrome,
  type SchemaIndex,
  shownNode,
  showsAncestor,
  useDebugFields,
  useFollow,
  useFrameView,
  useGraphRead,
  useNodePaletteOpen,
  usePane,
} from "@kb/ui-sdk";
import { useOutlineStore, outlineNodes } from "./outline.store";
import { pressRowBullet } from "./row-drag";
import { createTransientNode } from "./editing-writes";

import { FieldsSection } from "./fields-section";
import { FrameViewSlot } from "./frame-view-slot";
import { NodeContent } from "./node-content";
import { RowPreview } from "./row-preview";
import { openIn, useRowOpening, useRowView } from "./row-opening";
import { QueryResultsSection } from "./query-results";
import { useNodeKeyDown } from "./use-node-keydown";
import { openReferenceKey, openReferencesOf, opensInPlace } from "./open-references";
import { ViewToolbar } from "./view-toolbar";

interface NodeBlockProps {
  nodeId: string;
  depth: number;
  /**
   * Stable render-instance id (parent-path or ref-container + nodeId). Whether
   * the row is a projected row is read from it (`isProjectedRow`).
   */
  instanceKey?: string;
}

/** The node a row shows (`shownNode`), and its id even before the row's node loads. */
function rowShows(
  nodeId: string,
  node: OutlineNode | undefined,
  schema: SchemaIndex,
): { shown: OutlineNode | undefined; shownId: string } {
  if (!node) return { shown: undefined, shownId: nodeId };
  const shown = shownNode(node, schema);
  return { shown, shownId: shown.id };
}

export const NodeBlock = memo(function NodeBlock({
  nodeId,
  depth,
  instanceKey: instanceKeyProp,
}: NodeBlockProps) {
  // The row depends on the nodes it reads — its own, the one it shows, the
  // definitions its fields and tags name — not on the whole graph.
  const { outline, schema } = useGraphRead();
  const node = outline.get(nodeId);
  const activateNode = useOutlineStore((s) => s.activateNode);
  const selectNode = useOutlineStore((s) => s.selectNode);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const follow = useFollow();
  // Everything the row draws is its shown node's: for a contextual reference,
  // the target (`lib/contextual-ref`). Its place — selection, collapse, the
  // instance key, the keymaps — stays `nodeId`.
  const { shown, shownId } = rowShows(nodeId, node, schema);
  const showDebugFields = useDebugFields(shownId);

  const instanceKey = instanceKeyProp ?? outlineInstanceKey(nodeId, outline);
  // Focus is this instance's or not: a row re-renders when it gains or loses
  // it, not whenever it moves between other rows.
  const isActive = useOutlineStore(
    (s) => s.activeNodeId === nodeId && s.activeInstanceKey === instanceKey,
  );
  const isSelected = useOutlineStore(
    (s) => s.selectedNodeId === nodeId && s.selectedInstanceKey === instanceKey,
  );
  // A row of a range the selection's head is elsewhere in.
  // A row of a range of several rows, the head among them: drawn as one band.
  const inRange = useOutlineStore(
    (s) => s.selectedKeys.size > 1 && s.selectedKeys.has(instanceKey),
  );
  const extendSelection = useOutlineStore((s) => s.extendSelection);
  const nodePaletteOpen = useNodePaletteOpen();
  const isPaletteAnchor = nodePaletteOpen && (isSelected || isActive);

  // The one bullet rule (`bulletClickIntent`), reference rows included: a
  // plain click toggles, a modifier click follows to the node the row shows —
  // for a contextual reference, the original. (Also the guide-line strip's.)
  const handleBulletClick = useCallback(
    (e: React.MouseEvent) => {
      const intent = bulletClickIntent(e, true);
      if (intent === "toggle") toggleCollapse(nodeId);
      else follow(nodeTarget(shownId), intent);
    },
    [toggleCollapse, follow, shownId, nodeId],
  );

  // The bullet's menu gesture (a right click, a held finger) opens the node
  // menu on this row, as ⌘K does on a selected one.
  const handleBulletMenu = useCallback(() => {
    selectNode(nodeId, instanceKey);
    browserHost().setNodePaletteOpen(true);
  }, [selectNode, nodeId, instanceKey]);

  // A press on the bullet that travels drags the row (`row-drag`).
  const handleBulletPress = useCallback(
    (e: React.PointerEvent<HTMLElement>) => pressRowBullet(e, nodeId, instanceKey),
    [nodeId, instanceKey],
  );

  const handleActivate = useCallback(
    (cursorPos?: number) => {
      activateNode(nodeId, cursorPos, instanceKey);
    },
    [activateNode, nodeId, instanceKey],
  );

  const handleRowSelect = useCallback(
    (e: React.SyntheticEvent) => {
      if (e.target === e.currentTarget) {
        selectNode(nodeId, instanceKey);
      }
    },
    [selectNode, nodeId, instanceKey],
  );

  const handleKeyDown = useNodeKeyDown({ nodeId, instanceKey });

  // GAP [[01M7CY02KHSSAAENWJ67EA1EPH]]: no touch gesture makes a range yet.
  // Shift-click on a row moves the selection's head to it: a range. The
  // bullet's and a pointer's Shift-click open beside, and the row being
  // edited keeps Shift-click to select its text.
  const handleShiftClick = useCallback(
    (e: React.MouseEvent) => {
      if (!e.shiftKey || isActive) return;
      // A control's own Shift-click is the control's: an icon inside one is
      // drawn, not HTML, and is left to it as well.
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target === null || target.closest("button, a, [data-kb-ref-id]") !== null) return;
      e.preventDefault();
      e.stopPropagation();
      extendSelection({ instanceKey });
    },
    [extendSelection, instanceKey, isActive],
  );

  // The view the shown node's children are shown in: the frame is the shown node.
  const frameView = useFrameView(shown);
  const frameViewKey = frameView?.key ?? null;
  // The view the shown node's tag opens it in: on its tag's chip, and how the row shows the node.
  const opening = useRowOpening(shown);
  // The view the shown node's tag draws its row as, in place of its text.
  const rowView = useRowView(shown);
  const pane = usePane();

  if (!node || !shown) return null;

  const chrome = resolveRowChrome({
    node,
    schema,
    view: frameViewKey,
    instanceKey,
    showDebugFields,
    revealed: opening?.revealed,
  });

  return (
    <div
      className="node-block relative group/frame"
      data-node-block="true"
      data-node-id={nodeId}
      data-instance-key={instanceKey}
    >
      <div className="relative flex items-center" onClickCapture={handleShiftClick}>
        <div className="flex-1 min-w-0">
          <NodeRow
            depth={depth}
            nodeId={nodeId}
            instanceKey={instanceKey}
            isSelected={isSelected || isPaletteAnchor}
            inRange={inRange}
            isActive={isActive}
            onRowClick={handleRowSelect}
            bullet={
              <Bullet
                node={shown}
                collapsed={node.collapsed}
                collapsible={chrome.isExpandable}
                isRef={chrome.bulletIsRef}
                onClick={handleBulletClick}
                onMenu={handleBulletMenu}
                onPress={handleBulletPress}
              />
            }
            content={
              <NodeContent
                node={node}
                instanceKey={instanceKey}
                isActive={isActive}
                tags={shown.tags}
                rowView={rowView?.key ?? null}
                tagAction={
                  opening === null
                    ? undefined
                    : {
                        tag: opening.tag,
                        label: `Open in ${opening.label}`,
                        icon: <ArrowSquareOutIcon size="1em" weight="bold" />,
                        run: () => openIn(pane, shownId, opening.key),
                      }
                }
                onActivate={handleActivate}
                onKeyDown={handleKeyDown}
              />
            }
          />
        </div>
        {chrome.showToolbar && (
          // The toolbar stays out while something it opened is open (a
          // control of it is `aria-expanded`): the filters, or the query.
          <div
            className={cn(
              "absolute right-2 transition-opacity z-10",
              "opacity-0 group-hover/frame:opacity-100 group-focus-within/frame:opacity-100 has-[[aria-expanded=true]]:opacity-100",
            )}
          >
            <ViewToolbar frameId={shownId} view={frameViewKey} />
          </div>
        )}
      </div>

      <OpenReferences
        node={node}
        shown={shown}
        schema={schema}
        instanceKey={instanceKey}
        depth={depth}
      />

      {opening !== null && <RowPreview nodeId={shownId} opening={opening} depth={depth} />}

      {chrome.showsChildContainer && (
        <div className="children-container relative">
          <div
            className="absolute top-0 bottom-2 w-5 cursor-pointer group/line"
            style={guideLineStyle(depth)}
            onClick={handleBulletClick}
          >
            <div className="absolute left-[9px] top-0 bottom-0 w-px bg-foreground/[0.06] group-hover/line:bg-foreground/15 transition-colors duration-200" />
          </div>

          <FieldsSection nodeId={shownId} depth={depth} instanceKey={instanceKey} />

          {chrome.showsQueryResults && (
            <QueryResultsSection
              nodeId={shownId}
              depth={depth}
              view={frameViewKey}
              frameInstanceKey={instanceKey}
              renderNode={({ nodeId: rid, instanceKey: rInstanceKey, depth: rDepth }) => (
                <NodeBlock
                  key={rInstanceKey}
                  nodeId={rid}
                  instanceKey={rInstanceKey}
                  depth={rDepth}
                />
              )}
            />
          )}

          {chrome.showsChildren && (
            <RowChildren
              frameId={shownId}
              instanceKey={instanceKey}
              depth={depth + 1}
              projected={chrome.projected}
            />
          )}

          {chrome.showsCreateChild && <CreateChildStrip parentId={shownId} depth={depth} />}
        </div>
      )}
    </div>
  );
});

/**
 * The references the row's text opens in place (DESIGN-UI.md → Contextual
 * references, "A reference in the text opens in place"), each its target's
 * projected row, first under the row and drawn whether the row is open or
 * not. A row that repeats one above it draws none, as it draws no children.
 */
function OpenReferences({
  node,
  shown,
  schema,
  instanceKey,
  depth,
}: {
  node: OutlineNode;
  shown: OutlineNode;
  schema: SchemaIndex;
  instanceKey: string;
  depth: number;
}) {
  const expansion = useOutlineStore((s) => s.expansion);
  if (!opensInPlace(instanceKey) || showsAncestor(instanceKey, node, schema)) return null;
  return openReferencesOf(expansion, shown.id, shown.text).map((id) => {
    const key = openReferenceKey(shown.id, id);
    return <NodeBlock key={key} nodeId={id} instanceKey={key} depth={depth + 1} />;
  });
}

/**
 * Tana whitespace-create: the strip under a row's children mints a transient
 * child, last, under `parentId` — the node the row shows.
 */
function CreateChildStrip({ parentId, depth }: { parentId: string; depth: number }) {
  const handleCreateChild = useCallback(() => {
    const parent = outlineNodes().get(parentId);
    const lastChild = parent?.children.at(-1) ?? null;
    void createTransientNode(parentId, lastChild);
  }, [parentId]);

  return (
    <div
      data-create-child-zone={parentId}
      role="button"
      tabIndex={0}
      aria-label="New child node"
      className={cn(
        "group/create relative flex h-6 cursor-pointer items-center rounded-sm",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
      )}
      style={indentStyle(depth + 1)}
      onClick={handleCreateChild}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCreateChild();
        }
      }}
      title="New child node"
    >
      <span
        className="flex h-6 w-6 items-center justify-center text-ui leading-none text-foreground/0 transition-colors duration-150 group-hover/create:text-foreground/25 group-focus-visible/create:text-foreground/25"
        aria-hidden
      >
        +
      </span>
    </div>
  );
}

/**
 * A row's children, shown by their frame's view. A projected view is one
 * block, indented under the row; a list's rows indent themselves.
 */
function RowChildren({
  frameId,
  instanceKey,
  depth,
  projected,
}: {
  readonly frameId: string;
  readonly instanceKey: string;
  readonly depth: number;
  readonly projected: boolean;
}) {
  const slot = <FrameViewSlot frameId={frameId} instanceKey={instanceKey} depth={depth} />;
  return projected ? <div style={indentStyle(depth)}>{slot}</div> : slot;
}
