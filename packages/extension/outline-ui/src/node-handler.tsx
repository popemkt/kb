/**
 * A row's handler (DESIGN-UI.md → Opening a node → a row's handler): the
 * view the node's tag opens it in (`nodeHandlerOf`), offered on the row as
 * "Open in …" — the node menu's "Open with" row for that view — and, where
 * its family draws that view `inline` too, as a preview under the row.
 *
 * The preview is opt-in and cheap: its family's settings say whether it
 * draws one, whether one starts open and how tall it stands
 * (`previewSettingsOf`); the node's own toggle (`sys.f.preview`) opens or
 * closes it; it mounts only once on screen, in a box of fixed height, so a
 * long outline neither shifts nor pays for previews it never shows.
 */
import { useEffect, useState } from "react";
import { ArrowSquareOutIcon, CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Result } from "effect";
import { SYSTEM_IDS, previewShownOf, type NodeId } from "@kb/model";
import { paramsFromProps, type ViewKey } from "@kb/views";
import {
  browserHost,
  cn,
  indentStyle,
  nodePath,
  usePane,
  ViewSlot,
  type OutlineNode,
} from "@kb/ui-sdk";
import type { RowHandler } from "./row-handler";

const quiet = (): void => {};

/** Open `node` in `view` in pane `pane`: the node menu's "Open with" for that view. */
function openIn(pane: string, node: NodeId, view: ViewKey<unknown>): void {
  browserHost().navigatePane(pane, nodePath(node, view.option));
}

/** Set `node`'s preview open or closed: its own toggle, a field like any other. */
function setPreviewShown(node: NodeId, shown: boolean): void {
  void browserHost().writes.replaceField(node, SYSTEM_IDS.previewField, [{ t: "bool", v: shown }]);
}

/**
 * The row's "Open in …" and its preview toggle: on hover or focus where
 * there is a pointer that hovers, always there (and compact) on touch.
 */
export function HandlerActions({
  nodeId,
  node,
  handler,
}: {
  readonly nodeId: NodeId;
  readonly node: OutlineNode;
  readonly handler: RowHandler;
}) {
  const pane = usePane();
  const shown = handler.preview !== null && previewShownOf(node, handler.preview);
  const control = cn(
    "flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-label text-foreground/55",
    "outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50",
  );
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 transition-opacity",
        "opacity-0 group-hover/frame:opacity-100 group-focus-within/frame:opacity-100 focus-within:opacity-100",
        "[@media(hover:none)]:opacity-100",
      )}
      data-row-handler={handler.key.id}
    >
      {handler.preview === null ? null : (
        <button
          type="button"
          className={control}
          aria-expanded={shown}
          aria-label={shown ? "Hide preview" : "Show preview"}
          title={shown ? "Hide preview" : "Show preview"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setPreviewShown(nodeId, !shown)}
        >
          {shown ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}
          <span className="[@media(hover:none)]:sr-only">Preview</span>
        </button>
      )}
      <button
        type="button"
        className={control}
        title={`Open in ${handler.label}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => openIn(pane, nodeId, handler.key)}
      >
        {handler.icon}
        <span>
          <span className="[@media(hover:none)]:sr-only">Open in </span>
          {handler.label}
        </span>
        <ArrowSquareOutIcon size={12} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Whether the element given to the returned ref has come near the viewport;
 * once it has, it stays true. The element is state, so one that mounts after
 * its component (a preview opened later) is observed when it does.
 */
function useSeen(): readonly [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  // Where nothing can tell (no IntersectionObserver), everything counts as seen.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || el === null) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, seen]);
  return [setEl, seen];
}

/**
 * The preview under the row, when it is open: the handler's view at
 * placement `inline`, in a box of the family's height, mounted once on
 * screen. Pressing it opens the node in that view.
 */
export function HandlerPreview({
  nodeId,
  node,
  handler,
  depth,
}: {
  readonly nodeId: NodeId;
  readonly node: OutlineNode;
  readonly handler: RowHandler;
  readonly depth: number;
}) {
  const pane = usePane();
  const [box, seen] = useSeen();
  const settings = handler.preview;
  if (settings === null || !previewShownOf(node, settings)) return null;
  const params = paramsFromProps(handler.key, {}, nodeId, quiet);
  if (Result.isFailure(params)) return null;
  return (
    <div className="pr-2 pb-1" style={indentStyle(depth + 1)} data-row-preview={nodeId}>
      <div
        ref={box}
        role="button"
        tabIndex={0}
        aria-label={`Open in ${handler.label}`}
        title={`Open in ${handler.label}`}
        className={cn(
          "relative w-full overflow-hidden rounded-md border border-border bg-foreground/[0.02]",
          "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        )}
        style={{ height: settings.height }}
        onClick={() => openIn(pane, nodeId, handler.key)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          openIn(pane, nodeId, handler.key);
        }}
      >
        {seen ? (
          <ViewSlot
            view={handler.key}
            params={params.success}
            placement="inline"
            subject={nodeId}
            fallback={<span className="sr-only">No preview</span>}
          />
        ) : null}
      </div>
    </div>
  );
}
