import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { LockSimpleIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { ingestedOf, type IngestPort } from "../lib/ingest";
import { matchesChord, TEXT_HISTORY_CHORD } from "@kb/keybindings";
import { KB_TEXT_CLASS } from "../lib/md-inline";
import {
  getCaretSerializedOffset,
  readInlineInput,
  renderInlineMarkdown,
  revealMarkupAtSelection,
  serializeEditable,
  setCaretSerializedOffset,
} from "../lib/md-edit.ts";
import { nodeTarget, routePointerClick, type Follow } from "../lib/follow";
import { usePickerKeys } from "../lib/use-picker";
import type { PickerRow } from "../lib/picker";
import {
  openTriggerAt,
  refTrigger,
  type OpenTrigger,
  type TextTrigger,
  type TriggerPick,
} from "../lib/text-triggers";
import { rowTextReadOnlyReason } from "../lib/contextual-ref";
import { refInkOf } from "../lib/tag-color";
import type { SchemaIndex } from "../lib/schema";
import type { NodeMap, TagBadge } from "../lib/types";
import { InlineMarkdown } from "./md-view";
import { useRevealMarkup } from "./use-reveal-markup";
import { useTextHistory } from "./use-text-history";
import { PickerList } from "./picker-list";
import { nearestOffsetForX, offsetFromPoint } from "../lib/caret";
import { TagChipGroup, type TagChipAction } from "./tag-chip";

/** Where a caret placement puts the caret: an offset, the end, or a column to keep. */
export type CaretAt = number | "end" | { x: number };

/** A one-shot request for the text host mounted in `instanceKey` to place its caret. */
export interface CaretIntent {
  instanceKey: string;
  at: CaretAt;
}

/**
 * Everything the host needs that is not its view props: its reads of the
 * graph and of the caret hand-off, and its gestures. A surface takes it from
 * `useNodeTextBindingThrough` (`node-text-port.ts`), never piece by piece.
 */
export interface NodeTextHostBinding {
  nodes: NodeMap;
  /** What a reference's target resolves against (`rowTextReadOnlyReason`). */
  schema: SchemaIndex;
  /** Whether a node is served from its source file, so its text is changed there (`rowTextReadOnlyReason`). */
  isVirtual: (id: string) => boolean;
  pendingCaret: CaretIntent | null;
  /** Follow a pointer in the text (`useFollow`). */
  onFollow: Follow;
  consumeCaret: (instanceKey: string) => CaretIntent | null;
  placeCaret: (instanceKey: string, at: CaretAt) => void;
  selectNode: (id: string, instanceKey?: string) => void;
  registerTextHost: (instanceKey: string) => void;
  unregisterTextHost: (instanceKey: string) => void;
  setNodePaletteOpen: (open: boolean) => void;
}

export interface NodeTextHostProps extends NodeTextHostBinding {
  nodeId: string;
  instanceKey?: string;
  content: string;
  isActive: boolean;
  tags: TagBadge[];
  /** The action segment of one of `tags`' chips (`TagChipGroup`'s `tagAction`). */
  tagAction?: (TagChipAction & { readonly tag: string }) | undefined;
  /** Explicit local placement for non-outline hosts such as a page title. */
  initialCaret?: "end";
  /**
   * How the row is drawn while no one edits it, given its text as this host
   * draws it: a row view (DESIGN-UI.md → Row views), which places the text,
   * so pressing it still edits where it was pressed. Absent: the text.
   */
  display?: (text: ReactElement) => ReactNode;
  textClassName?: string;
  onBlur?: () => void;
  zoomTitleEditor?: boolean;
  onActivate: (cursorPos?: number) => void;
  onChange: (content: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /**
   * Where a paste or a drop into the text is offered (`lib/ingest`): the
   * surface's, which names the row. What it does not claim is the browser's.
   */
  ingest: IngestPort;
  /** The surface's writes: the text's node is the surface's to name (`shownNodeId`). */
  onRemoveTag: (tagId: string) => void;
}

/**
 * Put the caret where a placement asks, in the serialized text, and show the
 * markup it lands in. Returns the offset it took.
 */
function seatCaret(el: HTMLElement, at: CaretAt, length: number): number {
  let placed = at === "end" ? length : typeof at === "number" ? at : 0;
  setCaretSerializedOffset(el, placed);
  // Column preservation across vertical navigation (D11): nudge the caret to
  // the character whose visual x best matches the previous row.
  if (typeof at === "object") {
    const adjusted = nearestOffsetForX(el, at.x, "first") ?? nearestOffsetForX(el, at.x, "last");
    if (adjusted !== null) {
      setCaretSerializedOffset(el, adjusted);
      placed = adjusted;
    }
  }
  revealMarkupAtSelection(el);
  return placed;
}

/** The text-history step a chord asks for: ⌘Z undoes, ⇧⌘Z redoes. */
function historyChord(e: React.KeyboardEvent): "undo" | "redo" | null {
  if (!matchesChord(e, TEXT_HISTORY_CHORD)) return null;
  return e.shiftKey ? "redo" : "undo";
}

/** A row drawn as its text alone: what the host shows while no row view draws it. */
const shownAsText = (text: ReactElement): ReactNode => text;

/** The triggers every text offers (DESIGN-UI.md → Triggers in the text). */
const TRIGGERS: readonly TextTrigger[] = [refTrigger];

export function NodeTextHost({
  nodeId,
  instanceKey,
  content,
  isActive,
  tags,
  tagAction,
  initialCaret,
  display,
  textClassName,
  onBlur,
  zoomTitleEditor,
  onActivate,
  onChange,
  onKeyDown,
  nodes,
  schema,
  isVirtual,
  pendingCaret,
  onFollow,
  consumeCaret,
  placeCaret,
  selectNode,
  registerTextHost,
  unregisterTextHost,
  setNodePaletteOpen,
  ingest,
  onRemoveTag,
}: NodeTextHostProps) {
  /**
   * The row's one text element. It shows the same inline DOM whether the row
   * is being read or edited; editing makes it contentEditable and reveals the
   * markup of the segment under the caret.
   */
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const wasActive = useRef(false);
  /**
   * The last text this editor wrote that has not come back as `content` yet.
   * While one is pending, `content` is behind the DOM, not ahead of it.
   */
  const pendingEcho = useRef<string | null>(null);
  /** The text as last rendered: what a pick that resolves later is laid into. */
  const latest = useRef(content);
  useLayoutEffect(() => {
    latest.current = content;
  }, [content]);
  /** Query captured at dismissal time; a different query re-opens (D14). */
  const acDismissedQuery = useRef<string | null>(null);
  /** D14: Escape dismisses the popup without blurring or leaving edit mode. */
  const [acDismissed, setAcDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const readOnlyReason = rowTextReadOnlyReason(nodeId, nodes.get(nodeId), schema, isVirtual);
  /** How the text's references are inked, from the graph they point into. */
  const ink = refInkOf(schema);
  const readOnly = readOnlyReason !== null;
  const editing = isActive && !readOnly;
  /** Every write this editor makes goes through here (see `pendingEcho`). */
  const emit = useCallback(
    (text: string) => {
      if (text !== content) pendingEcho.current = text;
      onChange(text);
    },
    [content, onChange],
  );

  const rawOpen = useMemo(() => {
    if (!isActive || readOnly) return null;
    return openTriggerAt(TRIGGERS, content, cursor);
  }, [isActive, readOnly, content, cursor]);

  // Dismissal survives until the query itself changes or typing resumes.
  const typed = acDismissed && rawOpen?.open.query === acDismissedQuery.current ? null : rawOpen;

  // Rows exist only while a trigger is typed: a closed row asks for none.
  const rows = useMemo(
    () => (typed === null ? [] : typed.trigger.rows(typed.open.query, nodes)),
    [typed, nodes],
  );
  // A trigger with nothing to offer is closed, unless it answers Enter then.
  const triggered = typed !== null && (rows.length > 0 || typed.trigger.none !== undefined);
  const open = triggered ? typed : null;

  useLayoutEffect(() => {
    if (!isActive || instanceKey === undefined) return undefined;
    registerTextHost(instanceKey);
    return () => unregisterTextHost(instanceKey);
  }, [isActive, instanceKey, registerTextHost, unregisterTextHost]);

  useLayoutEffect(() => {
    const intent =
      instanceKey !== undefined && pendingCaret?.instanceKey === instanceKey ? pendingCaret : null;
    const localIntent =
      !intent && isActive && !wasActive.current && initialCaret
        ? { instanceKey: instanceKey ?? "local", at: initialCaret }
        : null;
    const placement = intent ?? localIntent;
    if (pendingEcho.current === content) pendingEcho.current = null;
    if (editing && editorRef.current && placement) {
      const el = editorRef.current;

      // GAP [[01M6HA0JJJDSFSJ3FPW8M8QC5K]] text another tab wrote while this row is focused is not taken, and is overwritten by the next keystroke
      // While editing, the DOM is the text. It is built from `content` when
      // the editor mounts (empty), and again only when `content` moved on its
      // own — a merge wrote this row — never from a `content` that has not
      // caught up with this editor's own writes yet.
      const movedOnItsOwn = pendingEcho.current === null && serializeEditable(el) !== content;
      if (!wasActive.current || movedOnItsOwn) renderInlineMarkdown(el, content, ink);
      wasActive.current = true;

      el.focus();
      const placedCursor = seatCaret(el, placement.at, content.length);
      setCursor(placedCursor);
      if (intent) consumeCaret(intent.instanceKey);
      setAcDismissed(false);
      acDismissedQuery.current = null;
    } else if (!editing) {
      wasActive.current = false;
      pendingEcho.current = null;
    }
  }, [editing, isActive, content, initialCaret, instanceKey, pendingCaret, consumeCaret, ink]);

  const restoreText = useCallback(
    (state: { text: string; caret: number }) => {
      setCursor(state.caret);
      emit(state.text);
    },
    [emit],
  );
  const stepTextHistory = useTextHistory({
    editorRef,
    editing,
    content,
    ink,
    onRestore: restoreText,
  });

  useRevealMarkup(editorRef, editing);

  /**
   * Lay a pick into the text: what it inserts replaces the trigger's span,
   * the caret after it, then its write. A pick that resolves later is laid
   * into the text as it is then, unless the span has changed meanwhile.
   */
  const applyPick = useCallback(
    async (made: TriggerPick | Promise<TriggerPick>, span: OpenTrigger) => {
      const was = content.slice(span.start, span.end);
      const pick = await made;
      const text = latest.current;
      if (text.slice(span.start, span.end) !== was) return;
      const next = text.slice(0, span.start) + pick.insert + text.slice(span.end);
      const caret = span.start + pick.insert.length;
      emit(next);
      if (editorRef.current) {
        renderInlineMarkdown(editorRef.current, next, ink);
        setCaretSerializedOffset(editorRef.current, caret);
        revealMarkupAtSelection(editorRef.current);
      }
      setCursor(caret);
      if (instanceKey !== undefined) placeCaret(instanceKey, caret);
      await pick.write?.();
    },
    [content, instanceKey, emit, placeCaret, ink],
  );

  /** A row picked, or (Enter with none) what the trigger does then. */
  const pickRow = (row: PickerRow | null) => {
    if (open === null) return;
    const made = row === null ? open.trigger.none?.(open.open) : open.trigger.pick(row, open.open);
    if (made !== undefined) void applyPick(made, open.open);
  };

  // The text's triggers open the one node picker; its keys run before the row's.
  const picker = usePickerKeys({
    rows,
    query: open?.open.query ?? "",
    scope: open?.trigger.id,
    pickOnTab: true,
    onPick: pickRow,
    onCancel: () => {
      acDismissedQuery.current = open?.open.query ?? null;
      setAcDismissed(true);
    },
  });

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (el && !isComposing.current) {
      const { text, caret } = readInlineInput(el, ink);
      setCursor(caret);
      acDismissedQuery.current = null;
      setAcDismissed(false);
      emit(text);
    }
  }, [emit, ink]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // A reference navigates and a link or player keeps its click, in both
      // states; everything else is a click into the text.
      if (routePointerClick(e, onFollow)) return;
      if (!isActive) {
        // F16: caret at click, not at end. The text is already the tree the
        // editor edits, so the point under the click is the offset to edit at.
        let at = content.length;
        const host = editorRef.current;
        if (host) {
          const probed = offsetFromPoint(host, e.clientX, e.clientY);
          if (probed !== null) at = Math.max(0, Math.min(probed, content.length));
        }
        onActivate(at);
      }
      e.stopPropagation();
    },
    [isActive, onActivate, onFollow, content],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!ingest.accepts("drop", [...e.dataTransfer.types])) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    [ingest],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!ingest.offer(ingestedOf("drop", e.dataTransfer))) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [ingest],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!ingest.offer(ingestedOf("paste", e.clipboardData))) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [ingest],
  );

  const handleCompositionStart = useCallback(() => {
    isComposing.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposing.current = false;
    handleInput();
  }, [handleInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isComposing.current) return;

      // Text undo is the row's own: native undo cannot follow a rebuilt tree.
      const history = historyChord(e);
      if (history !== null) {
        e.preventDefault();
        stepTextHistory(history);
        return;
      }

      // F15: '/' at offset 0 of an empty node opens the node palette (r1 Mode A MUST, before autocomplete).
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        content === "" &&
        getCaretSerializedOffset(editorRef.current) === 0
      ) {
        e.preventDefault();
        // Select this row so palette can anchor, then open it
        selectNode(nodeId, instanceKey);
        // rAF not available in happy-dom — fall back to sync
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => setNodePaletteOpen(true));
        } else {
          setNodePaletteOpen(true);
        }
        return;
      }

      if (open !== null && picker.handleKeyDown(e)) {
        // D14: Escape dismisses the popover only — stay editing, keep caret.
        if (e.key === "Escape") e.stopPropagation();
        return;
      }

      setCursor(getCaretSerializedOffset(editorRef.current));
      onKeyDown(e);
    },
    [
      open,
      picker,
      onKeyDown,
      content,
      nodeId,
      instanceKey,
      selectNode,
      setNodePaletteOpen,
      stepTextHistory,
    ],
  );

  const showPadlock = readOnly && !isActive;
  const textClass = cn(
    KB_TEXT_CLASS,
    "kb-text-row kb-md-view min-h-6 min-w-0 outline-none text-foreground/85",
    textClassName,
  );

  return (
    <>
      <div
        className="relative min-h-6 min-w-0 flex-1"
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/*
          Trailing chrome is a float, and a float can only displace line boxes
          that follow it — so it must come first in source order. This is what
          gives Tana's behaviour: the pill shortens the first line and every
          later line runs full width. As a flex sibling it narrowed all of them.
        */}
        {(showPadlock || tags.length > 0) && (
          <span className="kb-text-trailing flex items-center gap-1.5" data-node-trailing="true">
            {showPadlock && (
              <span
                className="shrink-0 text-foreground/25 opacity-0 transition-opacity duration-150 group-hover/node:opacity-100"
                title={readOnlyReason}
                data-read-only="true"
              >
                <LockSimpleIcon size={12} weight="bold" />
              </span>
            )}
            <TagChipGroup
              tags={tags}
              onTagClick={(tag, e) => {
                e.stopPropagation();
                onFollow(nodeTarget(tag.id), "open");
              }}
              onTagRemove={(tag, e) => {
                e.stopPropagation();
                onRemoveTag(tag.id);
              }}
              tagAction={tagAction}
            />
          </span>
        )}

        {editing ? (
          <div
            ref={editorRef}
            key="edit"
            className={cn(textClass, "editable caret-foreground/70")}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onKeyUp={() => setCursor(getCaretSerializedOffset(editorRef.current))}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onPaste={handlePaste}
            onBlur={onBlur}
            role="textbox"
            data-zoom-title-editor={zoomTitleEditor === true ? "true" : undefined}
          />
        ) : (
          (display ?? shownAsText)(
            // The same element and tree, owned by React while nothing edits it.
            <div ref={editorRef} key="view" className={textClass} role="presentation">
              {content ? <InlineMarkdown text={content} ink={ink} /> : "\u200B"}
            </div>,
          )
        )}

        {open !== null && (
          <PickerList
            placement="popover"
            anchorRef={editorRef}
            rows={rows}
            activeIndex={picker.activeIndex}
            onHover={picker.setActiveIndex}
            onPick={pickRow}
          />
        )}
      </div>
    </>
  );
}
