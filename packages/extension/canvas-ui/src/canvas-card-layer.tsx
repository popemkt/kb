import { memo, useState, type ReactNode } from "react";
import type { CanvasClip, CanvasDoc, CanvasNode, CanvasSide } from "@kb/canvas";
import {
  canvasDepth,
  canvasTop,
  isFileNode,
  isGroupNode,
  isKbNode,
  isLinkNode,
  itemClips,
  isPathNode,
  isShapeNode,
  isTextNode,
  itemShape,
  paintOrder,
  styleOf,
  svgPathData,
  topView,
  paintCss,
  itemPaint,
  cornerRadius,
  isPictureFile,
} from "@kb/canvas";
import { KbNodeCard, TextCard } from "./canvas-card";
import { ImageCard } from "./canvas-image-card";
import { LinkCard } from "./canvas-link-card";
import { ShapeCard } from "./shape-card";
import type { CanvasSelection } from "./canvas-selection";
import type { ResizeCorner } from "./canvas-pointer";
import { classifyCardPointer } from "./card-pointer";
import { cardBoxStyle } from "./canvas-card-box";
import type { FaceLayout } from "./canvas-face";
import { cn, hasText } from "@kb/ui-sdk";
import { readCornerRadii } from "./canvas-card-face";
import { ItemOutline } from "./canvas-item-outline";
import { inkStyle, wordsStyle } from "./canvas-dom-paint";
import { CanvasPorts } from "./canvas-ports";
import { CanvasResizeHandles } from "./canvas-resize-handles";
import { itemInWindow, type FloorWindow } from "./canvas-visible";
import { liftShadow } from "./canvas-chrome";

/**
 * What an item's face does when it is pressed and changed, by the page: one
 * object for the life of the stage (`useStableActions`), so a face is drawn
 * again only when what it draws changes.
 */
interface CanvasItemActions {
  onCardSelect: (card: CanvasNode, anchor?: { x: number; y: number }) => void;
  onCardChange: (card: CanvasNode) => void;
  onResizeStart: (cardId: string, corner: ResizeCorner, screen: { x: number; y: number }) => void;
  /** A press on a card's rotate handle, which turns the selection about its centre. */
  onRotateStart: (cardId: string, screen: { x: number; y: number }) => void;
  onPortDown: (cardId: string, side: CanvasSide, screen: { x: number; y: number }) => void;
  onCardPointerDown: (
    card: CanvasNode,
    event: React.PointerEvent,
    anchor?: { x: number; y: number },
  ) => void;
  /** An item's editor opened or closed. */
  onEdit: (id: string, editing: boolean) => void;
}

interface CanvasCardLayerProps {
  doc: CanvasDoc;
  selection: CanvasSelection;
  /** The item being edited, or null. */
  editing: string | null;
  /** The floor drawn (`floorWindow`): what lies outside it is not drawn, but for the selection and the item edited. Null draws everything. */
  window: FloorWindow | null;
  actions: CanvasItemActions;
}

/** What an item's face is drawn from: the card, whether it is selected, the page's actions, and where it is laid. */
type CanvasFaceProps = {
  card: CanvasNode;
  selected: boolean;
  actions: Omit<CanvasItemActions, "onEdit">;
} & FaceLayout;

/** Polygons as one SVG path's data in canvas units, a closed subpath each. */
function polygonsPath(polygons: readonly (readonly (readonly [number, number])[])[]): string {
  return polygons
    .flatMap(([first, ...rest]) =>
      first === undefined
        ? []
        : [svgPathData([["M", ...first], ...rest.map(([x, y]) => ["L", x, y] as const), ["Z"]])],
    )
    .join(" ");
}

/** An item's top view (`topView`) as path data: its pieces, filled nonzero to their union, and its rims. */
function topViewPaths(card: CanvasNode): { readonly pieces: string; readonly rims: string } {
  const view = topView({ ...card, shape: itemShape(card) }, cornerRadius(card, readCornerRadii()));
  return { pieces: polygonsPath(view.pieces), rims: polygonsPath(view.rims) };
}

/**
 * What tells height from the top: an item whose top stands off the floor —
 * raised, or a solid — casts its top view as a soft shadow, further and
 * softer the higher its top, as the 3D projection casts it on the floor.
 */
function CanvasLiftShadow({ card }: { card: CanvasNode }) {
  const top = canvasTop(card);
  if (top <= 0) return null;
  const { drop, blur } = liftShadow(top);
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 overflow-visible opacity-15 dark:opacity-50"
      width={1}
      height={1}
      style={{ transform: `translateY(${drop}px)` }}
    >
      <path
        d={topViewPaths(card).pieces}
        fill="rgb(0 0 0)"
        fillRule="nonzero"
        style={{ filter: `blur(${blur}px)` }}
      />
    </svg>
  );
}

/**
 * A solid's body as the top view sees it: everything it fills, seen from
 * straight above (`topView`), in its body's tint, under its face. Unturned,
 * the face covers it exactly; tilted, its sides show round the face, and
 * the pointer takes hold of the item there as on the face.
 */
// GAP [[01M540YKDP4WQPSJR41GH0Q90V]] canvas solid body tones are still set per projection
function CanvasItemBody({
  card,
  onPointerDown,
}: {
  card: CanvasNode;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  if (canvasDepth(card) <= 0) return null;
  const color = paintCss(styleOf(card).color) ?? "var(--foreground)";
  const { pieces, rims } = topViewPaths(card);
  return (
    <svg
      aria-hidden
      data-body
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={1}
      height={1}
    >
      <path
        d={pieces}
        className="pointer-events-auto"
        fill={`color-mix(in oklab, ${color} 22%, var(--background))`}
        fillRule="nonzero"
        onPointerDown={onPointerDown}
      />
      <path
        d={rims}
        fill="none"
        stroke={`color-mix(in oklab, ${color} 45%, transparent)`}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** An item's face: the card of its kind, laid out where its projection says (`box`). */
export function CanvasCardFace({
  card,
  projection,
  box,
  editing,
  onEdit,
  selected: isSelected,
  actions,
}: CanvasFaceProps) {
  const {
    onCardSelect,
    onCardChange,
    onResizeStart,
    onRotateStart,
    onPortDown,
    onCardPointerDown: handleCardPointerDown,
  } = actions;
  const layout = { projection, box, editing, onEdit };
  const resizeHandler = (event: React.PointerEvent, corner: ResizeCorner) => {
    onResizeStart(card.id, corner, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const rotateHandler = (event: React.PointerEvent) => {
    onRotateStart(card.id, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const portHandler = (cardId: string) => (side: CanvasSide, event: React.PointerEvent) => {
    onPortDown(cardId, side, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  if (isGroupNode(card)) {
    const paint = itemPaint(card);
    return (
      <div
        className="group/card absolute"
        style={box}
        onPointerDown={(e) => {
          if (classifyCardPointer(e.target, undefined) === "chrome") return;
          e.stopPropagation();
          handleCardPointerDown(card, e);
        }}
      >
        <ItemOutline item={card} paint={paint} selected={isSelected} />
        {hasText(card.label) && (
          <div
            data-words
            className="relative h-full px-2 py-1"
            style={{ ...wordsStyle(paint.words, true), ...inkStyle(paint.ink.words) }}
          >
            {card.label}
          </div>
        )}
        <CanvasResizeHandles
          selected={isSelected}
          onResizeStart={resizeHandler}
          onRotateStart={rotateHandler}
        />
        <CanvasPorts onPortDown={portHandler(card.id)} />
      </div>
    );
  }
  if (isTextNode(card)) {
    return (
      <TextCard
        {...layout}
        card={card}
        selected={isSelected}
        onSelect={() => {
          if (!isSelected) {
            onCardSelect(card);
          }
        }}
        onChange={onCardChange}
        onMoveStart={(e) => {
          handleCardPointerDown(card, e);
        }}
        onResizeStart={resizeHandler}
        onRotateStart={rotateHandler}
        onPortDown={portHandler(card.id)}
      />
    );
  }
  if (isShapeNode(card)) {
    return (
      <ShapeCard
        {...layout}
        card={card}
        selected={isSelected}
        onSelect={(anchor) => {
          if (!isSelected) {
            onCardSelect(card, anchor);
          }
        }}
        onLabelChange={(label) => onCardChange({ ...card, label })}
        onMoveStart={(e) => {
          handleCardPointerDown(card, e, {
            x: e.clientX,
            y: e.clientY,
          });
        }}
        onResizeStart={resizeHandler}
        onRotateStart={rotateHandler}
        onPortDown={portHandler(card.id)}
      />
    );
  }
  if (isPathNode(card)) {
    // A line is its chrome: its outline is the line, and what its ends wear.
    return (
      <div
        className="group/card absolute"
        style={box}
        onPointerDown={(e) => {
          if (classifyCardPointer(e.target, undefined) === "chrome") return;
          e.stopPropagation();
          handleCardPointerDown(card, e);
        }}
      >
        <ItemOutline item={card} paint={itemPaint(card)} selected={isSelected} />
        <CanvasResizeHandles
          selected={isSelected}
          onResizeStart={resizeHandler}
          onRotateStart={rotateHandler}
        />
        <CanvasPorts onPortDown={portHandler(card.id)} />
      </div>
    );
  }
  if (isFileNode(card) && isPictureFile(card.file)) {
    return (
      <ImageCard
        card={card}
        box={box}
        selected={isSelected}
        onSelect={() => {
          if (!isSelected) onCardSelect(card);
        }}
        onMoveStart={(e) => handleCardPointerDown(card, e)}
        onResizeStart={resizeHandler}
        onRotateStart={rotateHandler}
        onPortDown={portHandler(card.id)}
      />
    );
  }
  if (isLinkNode(card)) {
    return (
      <LinkCard
        card={card}
        box={box}
        selected={isSelected}
        onSelect={() => {
          if (!isSelected) onCardSelect(card);
        }}
        onMoveStart={(e) => handleCardPointerDown(card, e)}
        onResizeStart={resizeHandler}
        onRotateStart={rotateHandler}
        onPortDown={portHandler(card.id)}
      />
    );
  }
  if (!isKbNode(card)) {
    return (
      <div
        className={cn(
          "group/card absolute rounded-md border bg-background px-2 py-1 text-label text-foreground/40",
          isSelected ? "border-primary/40" : "border-foreground/[0.06]",
        )}
        style={box}
        onPointerDown={(e) => {
          e.stopPropagation();
          handleCardPointerDown(card, e);
        }}
      >
        {isFileNode(card) ? card.file : card.type}
        <CanvasResizeHandles
          selected={isSelected}
          onResizeStart={resizeHandler}
          onRotateStart={rotateHandler}
        />
        <CanvasPorts onPortDown={portHandler(card.id)} />
      </div>
    );
  }
  return (
    <KbNodeCard
      {...layout}
      card={card}
      selected={isSelected}
      onSelect={() => {
        if (!isSelected) {
          onCardSelect(card);
        }
      }}
      onMoveStart={(e) => {
        handleCardPointerDown(card, e);
      }}
      onResizeStart={resizeHandler}
      onRotateStart={rotateHandler}
      onPortDown={portHandler(card.id)}
    />
  );
}

/** What one item is drawn from: it, its clip, whether it is selected or edited, and the page's actions. */
interface CanvasItemProps {
  card: CanvasNode;
  clip: CanvasClip | undefined;
  selected: boolean;
  editing: boolean;
  actions: CanvasItemActions;
}

/**
 * One item: its shadow, and its body (a solid's top view) under its face,
 * both taking the pointer for it, drawn at its style's opacity and cut to
 * its clip. Drawn again only when one of those changes: an item another
 * gesture or another node moved is left as it is.
 */
const CanvasItem = memo(function CanvasItem({
  card,
  clip,
  selected,
  editing,
  actions,
}: CanvasItemProps) {
  const { opacity } = itemPaint(card);
  return (
    <CanvasClipped clip={clip}>
      <CanvasLiftShadow card={card} />
      <div
        data-card-id={card.id}
        data-selected={selected ? "" : undefined}
        style={opacity < 1 ? { opacity } : undefined}
      >
        <CanvasItemBody
          card={card}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            actions.onCardPointerDown(card, e, { x: e.clientX, y: e.clientY });
          }}
        />
        <CanvasCardFace
          card={card}
          selected={selected}
          actions={actions}
          box={cardBoxStyle(card)}
          projection="2d"
          editing={editing}
          onEdit={(on) => actions.onEdit(card.id, on)}
        />
      </div>
    </CanvasClipped>
  );
});

/** A clip (`itemClips`) as CSS: its polygon in canvas units, where the stage lays items out. */
function clipPathOf(clip: CanvasClip): string {
  const corners = clip.length < 3 ? [[0, 0] as const, [0, 0] as const, [0, 0] as const] : clip;
  return `polygon(${corners.map(([x, y]) => `${x}px ${y}px`).join(", ")})`;
}

/**
 * An item and its shadow, cut to where its frames reach (`itemClips`): a
 * frame clips what it holds. An item no frame holds is drawn whole.
 */
// GAP [[01M556WN27H5RAH0JSHERPAW82]] a clipped frame member's 2D selection handles are cut with it
function CanvasClipped({ clip, children }: { clip: CanvasClip | undefined; children: ReactNode }) {
  if (clip === undefined) return children;
  return (
    <div data-item-clip className="absolute top-0 left-0" style={{ clipPath: clipPathOf(clip) }}>
      {children}
    </div>
  );
}

/** The item `target` lies in, if any: the one holding the focus when it lands there. */
const itemOf = (target: EventTarget | null) =>
  target instanceof HTMLElement
    ? (target.closest<HTMLElement>("[data-card-id]")?.dataset.cardId ?? null)
    : null;

/**
 * The items, back to front (`paintOrder`): those the floor drawn meets, and
 * wherever they are the selection, the item edited and the item holding
 * the focus, so a pan never takes the focus or the edit away with an item.
 */
export const CanvasCardLayer = memo(function CanvasCardLayer({
  doc,
  selection,
  editing,
  window,
  actions,
}: CanvasCardLayerProps) {
  const [focused, setFocused] = useState<string | null>(null);
  const clips = itemClips(doc.nodes);
  return (
    <div
      data-canvas-stage
      className="contents"
      onFocus={(e) => setFocused(itemOf(e.target))}
      onBlur={(e) => {
        if (itemOf(e.relatedTarget) === null) setFocused(null);
      }}
    >
      {paintOrder(doc.nodes).map((card) => {
        const selected = selection.nodeIds.has(card.id);
        const edited = editing === card.id;
        const held = selected || edited || focused === card.id;
        if (window !== null && !held && !itemInWindow(window, card)) return null;
        return (
          <CanvasItem
            key={card.id}
            card={card}
            clip={clips.get(card.id)}
            selected={selected}
            editing={edited}
            actions={actions}
          />
        );
      })}
    </div>
  );
});
