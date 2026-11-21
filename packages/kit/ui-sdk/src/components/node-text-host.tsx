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
import { putFlavours } from "../lib/copy";
import { ingestedOf, type IngestPort } from "../lib/ingest";
import { textFlavours } from "../lib/text-copy";
import { isCompositionKey } from "../lib/keychord";
import { matchesChord, TEXT_HISTORY_CHORD } from "@kb/keybindings";
import { KB_TEXT_CLASS } from "../lib/md-inline";
import { browserHost } from "../host";
import {
  getCaretSerializedOffset,
  insertAtSelection,
  KB_REF_ID_ATTR,
  readInlineInput,
  renderInlineMarkdown,
  revealMarkupAtSelection,
  selectedSpan,
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
import { refLookOf } from "../lib/ref-look";
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
  registerTextHost: (instanceKey: string) => void;
  unregisterTextHost: (instanceKey: string) => void;
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
  /**
   * The text drawn while no one edits the row, where it is not `content`:
   * the node's title (DESIGN-UI.md → Titles from fields). Editing shows
   * `content`, and pressing the drawn title edits at its end. Absent:
   * `content`.
   */
  shown?: string | undefined;
  textClassName?: string;
  onBlur?: () => void;
  zoomTitleEditor?: boolean;
  onActivate: (cursorPos?: number) => void;
  /** A keystroke's text (`PageWrites.updateNodeContent`): the row's own text undo covers it. */
  onChange: (content: string) => void;
  /**
   * The text written whole, as a command writes it (`PageWrites.setNodeText`):
   * what a pick leaves in the text, written with the pick's own write as one.
   */
  writeText: (content: string) => Promise<unknown>;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /**
   * Where a paste or a drop into the text is offered (`lib/ingest`): the
   * surface's, which names the row. What it does not claim is the browser's.
   */
  ingest: IngestPort;
  /** The surface's writes: the text's node is the surface's to name (`shownNodeId`). */
  onRemoveTag: (tagId: string) => void;
  /**
   * The surface's own triggers, beside the `[[` every text has
   * (DESIGN-UI.md → Triggers in the text), first open first.
   */
  triggers?: readonly TextTrigger[] | undefined;
  /**
   * The references the surface shows open in place (DESIGN-UI.md →
   * Contextual references): their pills say so (`aria-expanded`).
   */
  openReferences?: ReadonlySet<string> | undefined;
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

/**
 * Mark the pills of the references open in place, after every render:
 * the text is drawn by React at rest and by the editor while edited, and
 * either may have redrawn it.
 */
function useOpenPills(
  editorRef: React.RefObject<HTMLDivElement | null>,
  open: ReadonlySet<string> | undefined,
): void {
  useLayoutEffect(() => {
    const pills = editorRef.current?.querySelectorAll<HTMLElement>(`[${KB_REF_ID_ATTR}]`) ?? [];
    for (const pill of pills) {
      const id = pill.getAttribute(KB_REF_ID_ATTR) ?? "";
      if (open?.has(id) === true) pill.setAttribute("aria-expanded", "true");
      else pill.removeAttribute("aria-expanded");
    }
  });
}

/** A surface with no triggers of its own. */
const NONE: readonly TextTrigger[] = [];

/**
 * The trigger typed at the caret while the text is edited, and its rows:
 * every text's `[[`, then the surface's `own`. Escape dismisses it until
 * its query changes or typing resumes (D14), and a trigger with nothing to
 * offer is closed, unless it answers Enter then.
 */
function useOpenTrigger(
  own: readonly TextTrigger[],
  editing: boolean,
  content: string,
  cursor: number,
  nodes: NodeMap,
) {
  const triggers = useMemo(() => [refTrigger, ...own], [own]);
  /** The query Escape dismissed the picker at, or null. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const typed = useMemo(() => {
    const at = editing ? openTriggerAt(triggers, content, cursor) : null;
    return at !== null && at.open.query === dismissed ? null : at;
  }, [editing, triggers, content, cursor, dismissed]);
  // Rows exist only while a trigger is typed: a closed row asks for none.
  const rows = useMemo(
    () => (typed === null ? [] : typed.trigger.rows(typed.open.query, nodes)),
    [typed, nodes],
  );
  const triggered = typed !== null && (rows.length > 0 || typed.trigger.none !== undefined);
  return { open: triggered ? typed : null, rows, setDismissed };
}

export function NodeTextHost({
  nodeId,
  instanceKey,
  content,
  isActive,
  tags,
  tagAction,
  initialCaret,
  display,
  shown = content,
  textClassName,
  onBlur,
  zoomTitleEditor,
  onActivate,
  onChange,
  writeText,
  onKeyDown,
  nodes,
  schema,
  isVirtual,
  pendingCaret,
  onFollow,
  consumeCaret,
  placeCaret,
  registerTextHost,
  unregisterTextHost,
  ingest,
  onRemoveTag,
  triggers: own = NONE,
  openReferences,
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
  const consuming = useRef(false);
  useLayoutEffect(() => {
    latest.current = content;
  }, [content]);
  const [cursor, setCursor] = useState(0);
  const readOnlyReason = rowTextReadOnlyReason(nodeId, nodes.get(nodeId), schema, isVirtual);
  /** How the text's references are inked, from the graph they point into. */
  const refs = refLookOf(schema);
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

  const { open, rows, setDismissed } = useOpenTrigger(own, editing, content, cursor, nodes);

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
      if (!wasActive.current || movedOnItsOwn) renderInlineMarkdown(el, content, refs);
      wasActive.current = true;

      el.focus();
      const placedCursor = seatCaret(el, placement.at, content.length);
      setCursor(placedCursor);
      if (intent) consumeCaret(intent.instanceKey);
      setDismissed(null);
    } else if (!editing) {
      wasActive.current = false;
      pendingEcho.current = null;
    }
  }, [
    editing,
    isActive,
    content,
    initialCaret,
    instanceKey,
    pendingCaret,
    consumeCaret,
    refs,
    setDismissed,
  ]);

  const restoreText = useCallback(
    (state: { text: string; caret: number }) => {
      setCursor(state.caret);
      emit(state.text);
    },
    [emit],
  );
  /**
   * The page's side of the row's history: its undo stacks, and its undo and
   * redo, the text then arriving as `content`, as `state` says or as the
   * page leaves it.
   */
  const page = useMemo(
    () => ({
      history: () => browserHost().writes.history(),
      step: async (direction: "undo" | "redo", state: { text: string; caret: number } | null) => {
        if (state !== null) {
          setCursor(state.caret);
          pendingEcho.current = state.text === latest.current ? null : state.text;
        }
        const { writes } = browserHost();
        await (direction === "undo" ? writes.undo() : writes.redo());
        return browserHost().node(nodeId)?.text ?? null;
      },
    }),
    [nodeId],
  );
  const textHistory = useTextHistory({
    editorRef,
    editing,
    content,
    refs,
    onRestore: restoreText,
    page,
  });

  useRevealMarkup(editorRef, editing);
  useOpenPills(editorRef, openReferences);

  /**
   * Lay a pick into the text as it is now, unless the span has changed
   * meanwhile. A pick that consumes the row owns the write and focus.
   * Otherwise what it inserts replaces the trigger's span, the caret after
   * it, and the text and the pick's own write are written as one write of
   * the page's (`PageWrites.together`), one undo step, which the row's
   * history holds in its place, tied to the page's undo entry it made
   * (`recordPick`). The text typed before the pick has landed by then, so
   * the undo brings it back. A refused write leaves the text and the caret
   * as they were.
   */
  const applyPick = useCallback(
    async (made: TriggerPick | null | Promise<TriggerPick | null>, span: OpenTrigger) => {
      const was = content.slice(span.start, span.end);
      const pick = await made;
      const text = latest.current;
      if (text.slice(span.start, span.end) !== was) return;
      if (pick === null || consuming.current) return;
      if ("consume" in pick) {
        consuming.current = true;
        try {
          await pick.consume();
        } finally {
          consuming.current = false;
        }
        return;
      }
      const before = { text, caret: span.end };
      const after = {
        text: text.slice(0, span.start) + pick.insert + text.slice(span.end),
        caret: span.start + pick.insert.length,
      };
      const lay = (state: typeof after) => {
        pendingEcho.current = state.text === latest.current ? null : state.text;
        if (editorRef.current) {
          renderInlineMarkdown(editorRef.current, state.text, refs);
          setCaretSerializedOffset(editorRef.current, state.caret);
          revealMarkupAtSelection(editorRef.current);
        }
        setCursor(state.caret);
        if (instanceKey !== undefined) placeCaret(instanceKey, state.caret);
      };
      const { writes } = browserHost();
      const below = writes.history().undo.at(-1);
      lay(after);
      textHistory.shown(after);
      const landed = await writes.together(async () => {
        await writeText(after.text);
        await pick.write?.();
        return true;
      });
      if (landed === null) {
        textHistory.shown(before);
        lay(before);
        return;
      }
      const entry = writes.history().undo.at(-1);
      if (entry !== below) textHistory.recordPick(before, after, entry);
      pick.landed?.();
    },
    [content, instanceKey, placeCaret, refs, textHistory, writeText],
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
    // D14: Escape dismisses the picker without blurring or leaving edit mode.
    onCancel: () => setDismissed(open?.open.query ?? null),
  });

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (el && !isComposing.current) {
      const { text, caret } = readInlineInput(el, refs);
      setCursor(caret);
      setDismissed(null);
      emit(text);
    }
  }, [emit, refs, setDismissed]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // A reference navigates and a link or player keeps its click, in both
      // states; everything else is a click into the text.
      if (routePointerClick(e, onFollow)) return;
      if (!isActive) {
        // F16: caret at click, not at end. The text is already the tree the
        // editor edits, so the point under the click is the offset to edit at.
        // A drawn title is not the text it edits: no point in it is an offset.
        let at = content.length;
        const host = editorRef.current;
        if (host && shown === content) {
          const probed = offsetFromPoint(host, e.clientX, e.clientY);
          if (probed !== null) at = Math.max(0, Math.min(probed, content.length));
        }
        onActivate(at);
      }
      e.stopPropagation();
    },
    [isActive, onActivate, onFollow, content, shown],
  );

  /** Text a paste or a drop makes, put in at the caret and read back as typing is. */
  const insertText = useCallback(
    (text: string) => {
      const el = editorRef.current;
      if (el && insertAtSelection(el, text)) handleInput();
    },
    [handleInput],
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
      if (!ingest.offer(ingestedOf("drop", e.dataTransfer), insertText)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [ingest, insertText],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!ingest.offer(ingestedOf("paste", e.clipboardData), insertText)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [ingest, insertText],
  );

  /**
   * A text selection copied: its source as words, rich text and itself; a
   * cut then takes it out as typing would, through the one insertion.
   */
  const copySelection = useCallback(
    (e: React.ClipboardEvent, cut: boolean) => {
      const el = editorRef.current;
      const span = el === null ? null : selectedSpan(el);
      if (el === null || span === null) return;
      const source = serializeEditable(el).slice(span.start, span.end);
      putFlavours(
        e.clipboardData,
        textFlavours(source, (id) => schema.get(id)),
      );
      e.preventDefault();
      e.stopPropagation();
      if (cut) insertText("");
    },
    [insertText, schema],
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
      if (isCompositionKey(e.nativeEvent, isComposing.current)) return;

      // Text undo is the row's own: native undo cannot follow a rebuilt tree.
      const history = historyChord(e);
      if (history !== null) {
        e.preventDefault();
        textHistory.step(history);
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
    [open, picker, onKeyDown, textHistory],
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
            onCopy={(e) => copySelection(e, false)}
            onCut={(e) => copySelection(e, true)}
            onBlur={onBlur}
            role="textbox"
            data-zoom-title-editor={zoomTitleEditor === true ? "true" : undefined}
          />
        ) : (
          (display ?? shownAsText)(
            // The same element and tree, owned by React while nothing edits it.
            <div ref={editorRef} key="view" className={textClass} role="presentation">
              {shown ? <InlineMarkdown text={shown} refs={refs} /> : "\u200B"}
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
            {...(open.trigger.createLabel === undefined
              ? {}
              : { createLabel: open.trigger.createLabel })}
          />
        )}
      </div>
    </>
  );
}
