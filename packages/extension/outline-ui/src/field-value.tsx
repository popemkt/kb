import {
  asInstance,
  browserHost,
  Bullet,
  bulletClickIntent,
  cn,
  getCaretSerializedOffset,
  INLINE_TEXT_CLASSES,
  InlineMarkdown,
  KB_REF_ID_ATTR,
  KB_TEXT_CLASS,
  NodeRow,
  nodeTarget,
  offsetFromPoint,
  OptionChip,
  useOptionPreview,
  optionColorOf,
  readInlineInput,
  refLookOf,
  renderInlineMarkdown,
  revealMarkupAtSelection,
  serializeEditable,
  setCaretSerializedOffset,
  TAG_PALETTE,
  TagChipGroup,
  useRevealMarkup,
  useTextTriggers,
  type EditHandle,
  type Follow,
  type FollowTarget,
  type NodeMap,
  type OpenTrigger,
  type OutlineNode,
  type RefLook,
  type RejectedInput,
  type TriggerPick,
  type ValueSurfaceProps,
  nameIn,
  HANGING_GLYPH,
} from "@kb/ui-sdk";
import { useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { parseDateInput, parseDay } from "@kb/model";
import { WarningIcon } from "@phosphor-icons/react";
import { CheckMark } from "./check-mark";
import { FieldPicker } from "./field-picker";
import { longDateLabel, relativeDateLabel } from "./date-display";
import { formatNumber } from "./number-format";
import { urlLabel } from "./url-label";
import { DateEditor } from "./date-editor";

const editableClass = cn("flex-1 outline-none rounded-sm px-1", KB_TEXT_CLASS);

/**
 * What a caret surface shows at rest: text's inline markdown, a url's link,
 * a number grouped in the locale's separators, or a secret's reference as a
 * code chip. A reference is never a key, and what a secret slot refused
 * (perhaps a pasted key) is never shown back: it rests masked, and the next
 * edit starts from the stored reference.
 */
type CaretDisplay = "markdown" | "link" | "number" | "reference";

/** What a secret slot shows for input it refused: a mask, never the input. */
const REFUSED_SECRET = "••••••••";

/**
 * A value that is text, edited in place by the same live preview node text
 * uses (DESIGN-UI.md → Node text is one surface): at rest the value is its
 * inline tree, and editing makes that tree contentEditable with the caret
 * where the click landed and the markup under the caret revealed. Typing is
 * read back through `readInlineInput`, so `**b**`, links and `[[ref]]` pills
 * format and follow exactly as they do in node text. A url and a number are
 * the same surface with a plain display: the url is a link at rest, and
 * neither has formatting to reveal.
 *
 * Text the kind cannot read is never dropped: the slot keeps it (`rejected`),
 * this shows it marked with the reason, and the next edit starts from it.
 */
function CaretValue({
  value,
  blank,
  editing,
  caretAt,
  seed,
  spec,
  rejected,
  onEnd,
  handleRef,
  placeholder,
  context,
  field,
  display: shownAs,
}: Omit<ValueSurfaceProps, "display"> & { display: CaretDisplay }) {
  // A text value's references are inked like node text's (`RefLook`).
  const refs = refLookOf(context.schema);
  const viewRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const stored = spec.text(value);
  const secret = shownAs === "reference";
  // A secret slot's refused input is never kept as text to show or edit from.
  const text = secret ? stored : (rejected?.text ?? stored);

  useLayoutEffect(() => {
    const el = editRef.current;
    if (!editing || el === null) return;
    const start = seed ?? text;
    renderCaretText(el, start, shownAs, refs);
    el.focus();
    setCaretSerializedOffset(
      el,
      caretAt === "end" || seed !== undefined ? start.length : Math.min(caretAt, start.length),
    );
    revealMarkupAtSelection(el);
    // Entering is the only time the DOM is built from `text`: while editing,
    // the DOM is the text.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- rebuilt on entry only
  }, [editing]);

  useRevealMarkup(editRef, editing);

  useCaretHandle({ handleRef, editRef, viewRef, stored, shownAs, refs });

  const finish = () => {
    const next = editRef.current === null ? text : serializeEditable(editRef.current);
    if (next === stored) onEnd();
    else onEnd(spec.parse(next), next);
  };

  const showEmpty = blank && !text;
  // An open editor's placeholder is its own `:empty::before`, so what is
  // typed over it is in the value's tone; the empty tone is the slot at rest.
  const tone =
    showEmpty && !editing
      ? "text-foreground/25 italic"
      : rejected !== null
        ? "text-warning underline decoration-wavy decoration-warning/50 underline-offset-2"
        : "text-foreground/70";
  const textClass = cn(
    editableClass,
    "kb-md-view min-w-0 cursor-text whitespace-pre-wrap",
    shownAs === "number" && "tabular-nums",
    tone,
  );

  return (
    <div className="flex min-w-0 flex-1 items-start">
      {editing ? (
        <CaretEditor
          editRef={editRef}
          placeholder={placeholder}
          className={cn(textClass, "editable")}
          refs={shownAs === "markdown" ? refs : null}
          nodes={context.outline}
          holder={field.holder}
          onFinish={finish}
          onPaste={(e) => {
            // A link pasted into an empty url slot is the whole gesture.
            const pasted = e.clipboardData.getData("text/plain").trim();
            if (shownAs !== "link" || !showEmpty || pasted === "" || /\n/.test(pasted)) return;
            e.preventDefault();
            onEnd(spec.parse(pasted), pasted);
          }}
        />
      ) : (
        <CaretRest
          viewRef={viewRef}
          className={cn(textClass, showEmpty && "empty-placeholder")}
          text={restText(shownAs, value, showEmpty ? null : text, rejected !== null)}
          href={shownAs === "link" && rejected === null ? spec.follow(value) : null}
          markdown={shownAs === "markdown" && rejected === null}
          chip={secret && rejected === null}
          refs={refs}
          rejected={rejected}
        />
      )}
    </div>
  );
}

/**
 * What a caret value shows at rest: nothing while unset (`text` null), a
 * mask for input a secret slot refused, a number grouped, else the text.
 */
function restText(
  shownAs: CaretDisplay,
  value: ValueSurfaceProps["value"],
  text: string | null,
  refused: boolean,
): string | null {
  if (shownAs === "reference" && refused) return REFUSED_SECRET;
  if (text === null) return null;
  if (shownAs === "number" && !refused && value.t === "num") return formatNumber(value.v);
  return text;
}

/**
 * Build a caret editor's tree: text is its inline markdown, and a url or a
 * number its plain string — a url's `_`, `*` or bare `https://` is its own,
 * not markup, and a number has none.
 */
function renderCaretText(
  el: HTMLElement,
  text: string,
  shownAs: CaretDisplay,
  refs: RefLook,
): void {
  if (shownAs === "markdown") renderInlineMarkdown(el, text, refs);
  else el.textContent = text;
}

/** A caret value's side of the slot's keymap (`EditHandle`), over its two elements. */
function useCaretHandle({
  handleRef,
  editRef,
  viewRef,
  stored,
  shownAs,
  refs,
}: {
  handleRef: React.Ref<EditHandle>;
  editRef: React.RefObject<HTMLDivElement | null>;
  viewRef: React.RefObject<HTMLDivElement | null>;
  stored: string;
  shownAs: CaretDisplay;
  refs: RefLook;
}) {
  useImperativeHandle(
    handleRef,
    () => ({
      commit: () => editRef.current?.blur(),
      cancel: () => {
        if (editRef.current) renderCaretText(editRef.current, stored, shownAs, refs);
        editRef.current?.blur();
      },
      softBreak: () => {
        const el = editRef.current;
        if (el === null || shownAs !== "markdown") return;
        const current = serializeEditable(el);
        const at = getCaretSerializedOffset(el);
        renderInlineMarkdown(el, `${current.slice(0, at)}\n${current.slice(at)}`, refs);
        setCaretSerializedOffset(el, at + 1);
        revealMarkupAtSelection(el);
      },
      caret: () => {
        const el = editRef.current;
        if (el === null) return null;
        return { at: getCaretSerializedOffset(el), length: serializeEditable(el).length };
      },
      atEnd: () => {
        const el = editRef.current;
        if (el === null) return false;
        const typed = serializeEditable(el);
        return typed.trim() !== "" && getCaretSerializedOffset(el) >= typed.length;
      },
      caretAtPoint: (x, y) => {
        // Only a surface whose rest tree is its edit tree can map a point to
        // an offset; a url's short label and a grouped number are not the
        // text they edit.
        const el = viewRef.current;
        if (el === null || shownAs === "link" || shownAs === "number") return "end";
        return offsetFromPoint(el, x, y) ?? "end";
      },
    }),
    [editRef, viewRef, stored, shownAs, refs],
  );
}

/**
 * A caret value while it edits: the inline tree made contentEditable, typing
 * read back through `readInlineInput` (outside an IME composition). A text
 * value is a text, so `[[` opens the node picker at its caret as it does in
 * node text (`useTextTriggers`), and a pick lays its reference into the value
 * being edited; the edit is written when it is kept, as all of it is.
 */
function CaretEditor({
  editRef,
  placeholder,
  className,
  refs,
  nodes,
  holder,
  onFinish,
  onPaste,
}: {
  editRef: React.RefObject<HTMLDivElement | null>;
  placeholder: string | undefined;
  className: string;
  /** How the text's references read (`RefLook`); null for a plain editor, which has no tree to re-form. */
  refs: RefLook | null;
  /** What `[[` offers, less the node holding the value. */
  nodes: NodeMap;
  holder: string | null;
  onFinish: () => void;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
}) {
  const composing = useRef(false);
  /** The text as typed and the caret in it: what the triggers read. */
  const [typed, setTyped] = useState({ text: "", caret: 0 });

  /** Lay a pick into the value as it is now, unless its span changed meanwhile. */
  const lay = async (made: TriggerPick | null | Promise<TriggerPick | null>, span: OpenTrigger) => {
    const el = editRef.current;
    if (el === null || refs === null) return;
    const was = serializeEditable(el).slice(span.start, span.end);
    const pick = await made;
    const text = serializeEditable(el);
    if (pick === null || text.slice(span.start, span.end) !== was) return;
    if ("consume" in pick) {
      await pick.consume();
      return;
    }
    const next = text.slice(0, span.start) + pick.insert + text.slice(span.end);
    const caret = span.start + pick.insert.length;
    renderInlineMarkdown(el, next, refs);
    setCaretSerializedOffset(el, caret);
    revealMarkupAtSelection(el);
    setTyped({ text: next, caret });
    await pick.write?.(browserHost().writes);
    pick.landed?.();
  };

  const triggers = useTextTriggers({
    editing: refs !== null,
    text: typed.text,
    cursor: typed.caret,
    nodes,
    nodeId: holder ?? "",
    textNodeId: holder ?? "",
    anchorRef: editRef,
    apply: (made, span) => void lay(made, span),
  });

  const read = () => {
    if (editRef.current === null || refs === null) return;
    setTyped(readInlineInput(editRef.current, refs));
    triggers.resume();
  };

  return (
    <>
      <div
        key="edit"
        ref={editRef}
        className={className}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        data-editable-text="true"
        data-placeholder={placeholder}
        onInput={() => {
          if (!composing.current) read();
        }}
        onKeyDown={(e) => {
          // An open picker's keys are its own: the slot must not also commit or leave.
          if (triggers.keyDown(e)) e.stopPropagation();
        }}
        onKeyUp={() => {
          const el = editRef.current;
          if (el !== null)
            setTyped({ text: serializeEditable(el), caret: getCaretSerializedOffset(el) });
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          read();
        }}
        onBlur={onFinish}
        onPaste={onPaste}
      />
      {triggers.list}
    </>
  );
}

/**
 * A caret value at rest: its inline tree (text), its link (url) or its plain
 * string, or — refused input — that input marked with the reason.
 */
function CaretRest({
  viewRef,
  className,
  text,
  href,
  markdown,
  chip,
  refs,
  rejected,
}: {
  viewRef: React.RefObject<HTMLDivElement | null>;
  className: string;
  /** Null: the slot is unset and shows its placeholder. */
  text: string | null;
  href: FollowTarget | null;
  markdown: boolean;
  /** A secret's reference: shown as a code chip, as inline code is. */
  chip: boolean;
  refs: RefLook;
  rejected: RejectedInput | null;
}) {
  const long = useLongValue(viewRef, text);
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          key="view"
          ref={viewRef}
          className={cn(className, long.clamped && LONG_VALUE_CLAMP)}
          data-editable-text="true"
          data-empty-placeholder={text === null ? "true" : undefined}
          data-rejected={rejected !== null ? "true" : undefined}
          data-clamped={long.clamped ? "true" : undefined}
          aria-invalid={rejected !== null || undefined}
          title={rejected?.reason}
        >
          {/* D17: empty state is CSS-only (:empty::before) — the DOM stays
            empty so the caret lands on a truly blank editor. */}
          {text === null ? null : href?.kind === "href" ? (
            <UrlLink href={href.href} />
          ) : markdown ? (
            <InlineMarkdown text={text} refs={refs} />
          ) : chip ? (
            <span className={INLINE_TEXT_CLASSES.code} data-secret-ref="true">
              {text}
            </span>
          ) : (
            text
          )}
        </div>
        {long.toggle && (
          <button
            type="button"
            tabIndex={-1}
            aria-expanded={!long.clamped}
            data-long-value-toggle="true"
            className="self-start px-1 text-meta text-foreground/40 hover:text-foreground/70"
            onClick={(e) => {
              // Reading it whole is not editing it.
              e.stopPropagation();
              long.flip();
            }}
          >
            {long.clamped ? "Show more" : "Show less"}
          </button>
        )}
      </div>
      {rejected !== null && (
        <span
          className="flex h-6 w-4 shrink-0 items-center justify-center text-warning"
          title={rejected.reason}
          data-mismatch-warning="true"
        >
          <WarningIcon size={11} weight="fill" aria-hidden />
        </span>
      )}
    </>
  );
}

/** How many lines a long value shows at rest before it is clamped (DESIGN-UI.md → Long text). */
const LONG_VALUE_CLAMP = "line-clamp-6";

/**
 * Whether a value at rest is clamped (DESIGN-UI.md → Long text): a value
 * longer than its clamp shows the clamp's lines and a toggle to read it
 * whole, and back. Whether it overflows is measured on the drawn value, again
 * when its text or its width changes; reading it whole is this drawn
 * value's passing state, written nowhere.
 */
function useLongValue(viewRef: React.RefObject<HTMLDivElement | null>, text: string | null) {
  const [whole, setWhole] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = viewRef.current;
    // An unset value has nothing to clamp; a new text is measured anew.
    if (el === null || whole || text === null) return undefined;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewRef, text, whole]);
  return {
    clamped: !whole,
    toggle: whole || overflows,
    flip: () => setWhole((was) => !was),
  };
}

/**
 * A url value at rest: a real anchor, so the browser's own open, middle-click,
 * status-bar preview and "Copy link" all work. The label is short and capped
 * below the slot's width, so there is always space beside it to click into
 * the value; the full url is the title.
 */
function UrlLink({ href }: { href: string }) {
  return (
    <a
      className={cn(
        INLINE_TEXT_CLASSES.link,
        "inline-block max-w-[calc(100%-0.75rem)] truncate align-bottom text-primary",
        "underline decoration-primary/25 underline-offset-2 hover:decoration-primary/60",
      )}
      href={href}
      title={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {urlLabel(href)}
    </a>
  );
}

/** Text: inline markdown at rest, the live preview while edited. */
export function TextSurface(props: ValueSurfaceProps) {
  return <CaretValue {...props} display="markdown" />;
}

/** A url: a link at rest, labelled short. */
export function UrlSurface(props: ValueSurfaceProps) {
  return <CaretValue {...props} display="link" />;
}

/** A secret: the reference to where its key lives, as a chip; never a key. */
export function SecretSurface(props: ValueSurfaceProps) {
  return <CaretValue {...props} display="reference" />;
}

/** A number: grouped in the locale's separators at rest. */
export function NumberSurface(props: ValueSurfaceProps) {
  return <CaretValue {...props} display="number" />;
}

/**
 * A checkbox value: a real checkbox, not a switch (a switch reads as a device
 * setting). The slot owns the toggle; this is a button so it is a Tab stop
 * and Space or Enter activate it. Unset and off look the same.
 */
export function CheckboxSurface({ value }: ValueSurfaceProps) {
  const on = value.t === "bool" && value.v;
  return (
    <span className="flex h-6 items-center px-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={on ? "Checked" : "Unchecked"}
        className="group/check flex shrink-0 rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <CheckMark checked={on} />
      </button>
    </span>
  );
}

/**
 * A date value: at rest its label near today (`Today`, `Fri`, `Oct 12`),
 * read from its local calendar day, with the full date as the title; while
 * the slot edits, the date editor — typed phrases or the calendar — seeded
 * with the stored date, or with input the slot kept, and keyed by the slot
 * as every value is (its arrows aside).
 */
export function DateSurface({
  value,
  spec,
  editing,
  seed,
  rejected,
  onEnd,
  handleRef,
}: ValueSurfaceProps) {
  const stored = spec.text(value);
  // A stored date in an older form (an ISO timestamp) still reads as its day.
  const canonical = stored === "" ? "" : (parseDateInput(stored) ?? stored);
  const date = parseDay(canonical);

  if (editing) {
    return (
      <DateEditor
        initialText={seed ?? rejected?.text ?? canonical}
        onCommit={(text) => onEnd(spec.parse(text), text)}
        onCancel={() => onEnd()}
        handleRef={handleRef}
      />
    );
  }

  const shown = rejected?.text ?? (date === null ? stored : relativeDateLabel(date));
  return (
    <span className="flex min-w-0 items-start">
      <span
        className={cn(
          editableClass,
          "cursor-text tabular-nums",
          shown === ""
            ? "empty-placeholder text-foreground/25 italic"
            : rejected !== null
              ? "text-warning underline decoration-wavy decoration-warning/50 underline-offset-2"
              : "text-foreground/70",
        )}
        data-empty-placeholder={shown === "" ? "true" : undefined}
        data-rejected={rejected !== null ? "true" : undefined}
        title={rejected?.reason ?? (date === null ? undefined : longDateLabel(date))}
      >
        {shown}
      </span>
      {rejected !== null && (
        <span
          className="flex h-6 w-4 shrink-0 items-center justify-center text-warning"
          title={rejected.reason}
          data-mismatch-warning="true"
        >
          <WarningIcon size={11} weight="fill" aria-hidden />
        </span>
      )}
    </span>
  );
}

export function ColorSurface({ value, spec, onEnd }: ValueSurfaceProps) {
  return (
    <ColorSwatchEditor value={spec.text(value)} onCommit={(hex) => onEnd(spec.parse(hex), hex)} />
  );
}

/**
 * Color field editor — palette swatches + optional custom hex.
 * Used for sys.f.color on tag schema (and any other color field).
 */
export function ColorSwatchEditor({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (hex: string) => void;
}) {
  const current = value.trim();
  const [custom, setCustom] = useState(current);

  return (
    <div
      className="flex min-h-6 flex-wrap items-center gap-1 py-0.5"
      data-color-swatch-editor="true"
      role="group"
      aria-label="Color"
    >
      {TAG_PALETTE.map((hex) => {
        const selected = current.toLowerCase() === hex.toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            title={hex}
            aria-label={`Set color ${hex}`}
            aria-pressed={selected}
            className={cn(
              "h-4 w-4 shrink-0 rounded-sm border transition-shadow",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              selected
                ? "border-foreground/50 ring-2 ring-primary/40"
                : "border-foreground/15 hover:border-foreground/35",
            )}
            style={{ backgroundColor: hex }}
            onClick={() => {
              setCustom(hex);
              onCommit(hex);
            }}
          />
        );
      })}
      <input
        type="text"
        value={custom}
        spellCheck={false}
        placeholder="#hex"
        aria-label="Custom color hex"
        className={cn(
          "ml-1 h-5 w-[5.5rem] rounded-sm border border-border bg-transparent px-1",
          "font-mono text-label text-foreground/60 outline-none",
          "placeholder:text-faint-foreground focus:border-foreground/25",
        )}
        onChange={(e) => setCustom(e.target.value)}
        onBlur={() => {
          const next = custom.trim();
          if (/^#[0-9a-fA-F]{3,8}$/.test(next) && next !== current) {
            onCommit(next);
          } else {
            setCustom(current);
          }
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            asInstance(e.target, HTMLElement)?.blur();
          }
        }}
      />
    </div>
  );
}

/** A resolved ref: the target's own row. Activating the slot opens the search. */
function ResolvedRefRow({
  refId,
  target,
  name,
  onFollow,
}: {
  refId: string;
  target: OutlineNode;
  /** The target's name (`nameIn`, DESIGN.md → Display text). */
  name: string;
  onFollow: Follow;
}) {
  // A row on the value column, its bullet hung in the label's last glyph
  // column, so its words start where every value's do.
  return (
    <div style={HANGING_GLYPH}>
      <NodeRow
        depth={0}
        nodeId={refId}
        className="cursor-pointer"
        bullet={
          <Bullet
            node={{ ...target, collapsed: true }}
            isRef
            onClick={(e) => {
              e.stopPropagation();
              // A value's bullet has nothing of its own to expand, so it follows.
              const intent = bulletClickIntent(e, false);
              if (intent !== "toggle") onFollow(nodeTarget(refId), intent);
            }}
          />
        }
        content={
          <>
            {/* The label is a pointer segment: a plain click follows it, the
              way a `[[ref]]` pill does. The rest of the row edits the value.
              A resolved target's name is the label; the caller's
              `display` is only ever a fallback for an *un*resolved id. */}
            <span
              className={cn(
                KB_TEXT_CLASS,
                "min-w-0 cursor-pointer truncate text-foreground/70 hover:underline",
                "decoration-foreground/25 underline-offset-2",
              )}
              {...{ [KB_REF_ID_ATTR]: refId }}
            >
              {name || "​"}
            </span>
            {target.tags.length > 0 && (
              <TagChipGroup
                tags={target.tags}
                onTagClick={(tag, e) => {
                  e.stopPropagation();
                  onFollow(nodeTarget(tag.id), "open");
                }}
              />
            )}
          </>
        }
      />
    </div>
  );
}

/**
 * A ref whose target is not in the graph.
 *
 * A display label makes it a known node rendered by label — the chip stays
 * quiet. Without one there is nothing to show but the id, and that is what the
 * warning glyph is for: a specific unresolved id, not a generic complaint.
 */
function UnresolvedRefChip({ refId, display }: { refId: string; display: string }) {
  const hasDisplay = Boolean(display && display !== refId);
  return (
    <span
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-px",
        "kb-text text-foreground/70",
        hasDisplay ? "bg-primary/8 hover:bg-primary/12" : "bg-warning/10 hover:bg-warning/15",
        "transition-colors duration-100",
      )}
      title={hasDisplay ? `Node: ${refId}` : `Unresolved ref: ${refId}`}
      data-unresolved-ref={!hasDisplay ? "true" : undefined}
    >
      {!hasDisplay && <span className="text-warning text-label leading-none">⚠</span>}
      <span
        className={cn(
          "h-1 w-1 shrink-0 rounded-full",
          hasDisplay ? "bg-foreground/35" : "bg-warning/60",
        )}
      />
      <span className="max-w-[200px] truncate">{hasDisplay ? display : refId}</span>
    </span>
  );
}

/**
 * A ref value: one of four states. While the slot edits, the search; at rest,
 * the target's row, the unresolved chip, or the quiet placeholder of an unset
 * slot, which the slot opens when it receives focus (`opensOnFocusWhenEmpty`).
 *
 * The field's declared targets are an *input* to candidate resolution, never
 * a filter over its output — lib/refs owns membership (`refSearchOf`), and a
 * field's declared targets outrank its hide-infrastructure heuristic.
 */
export function RefSurface({
  value,
  spec,
  editing,
  seed,
  display,
  fieldId,
  context,
  field,
  onEnd,
  onFollow,
}: ValueSurfaceProps) {
  const refId = spec.text(value);
  if (editing) {
    return (
      <FieldPicker
        fieldId={fieldId}
        context={context}
        field={field}
        initialQuery={seed}
        onReplace={(id) => onEnd(spec.parse(id), id)}
        onClose={() => onEnd()}
      />
    );
  }
  const target = context.schema.get(refId);
  if (target) {
    const name = nameIn(context.schema, refId);
    return <ResolvedRefRow refId={refId} target={target} name={name} onFollow={onFollow} />;
  }
  if (refId) return <UnresolvedRefChip refId={refId} display={display} />;
  return (
    <span
      className={cn(editableClass, "block cursor-text italic empty-placeholder text-foreground/25")}
      data-empty-placeholder="true"
      data-ref-slot="closed"
    />
  );
}

/**
 * An option value: a node picked from its field's own list, drawn as the chip
 * a tag is drawn as, in the option's colour (`optionColorOf`). The chip is a
 * pointer segment — a plain click opens the option's page — and the slot
 * around it edits, opening the same picker a ref value uses.
 */
export function OptionSurface({
  value,
  spec,
  editing,
  seed,
  display,
  fieldId,
  context,
  field,
  onEnd,
}: ValueSurfaceProps) {
  const optionId = spec.text(value);
  const preview = useOptionPreview(fieldId);
  if (editing) {
    return (
      <FieldPicker
        fieldId={fieldId}
        context={context}
        field={field}
        initialQuery={seed}
        onReplace={(id) => onEnd(spec.parse(id), id)}
        onClose={() => onEnd()}
      />
    );
  }
  const option = context.schema.get(optionId);
  if (option) {
    return (
      <span className="flex h-6 items-center gap-1 px-1">
        {preview?.(optionId)}
        <OptionChip
          id={optionId}
          label={nameIn(context.schema, optionId) || optionId}
          color={optionColorOf(option, context.schema.get(fieldId))}
        />
      </span>
    );
  }
  if (optionId) return <UnresolvedRefChip refId={optionId} display={display} />;
  return (
    <span
      className={cn(editableClass, "block cursor-text italic empty-placeholder text-foreground/25")}
      data-empty-placeholder="true"
      data-ref-slot="closed"
    />
  );
}
