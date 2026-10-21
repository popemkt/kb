import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FunnelIcon, PlusIcon, TextTIcon, XIcon } from "@phosphor-icons/react";
import {
  browserHost,
  type EnumOption,
  EnumSelect,
  getViewConfig,
  POPOVER_VALUE_CLASS,
  PopoverShell,
  PrefFieldRow,
  toast,
  useViewSettingsFrame,
  useFrameViewNode,
  usePageGraph,
  useDismiss,
} from "@kb/ui-sdk";
import { serializeViewFilter, type ViewFilter } from "@kb/views";
import { outlineNodes, useOutlineNode } from "./outline.store";
import { listFilterFieldOptions } from "./view-settings-fields";
import { ViewSettingsSections } from "./view-settings-sections";

/** The two rows a view filter's stored syntax spells (`ViewFilter`). */
type FilterKind = ViewFilter["kind"];

const FILTER_KIND_OPTIONS: readonly EnumOption<FilterKind>[] = [
  { value: "field-is", label: "field equals" },
  { value: "anywhere-contains", label: "text contains" },
];

function filterLabel(f: ViewFilter): string {
  if (f.kind === "anywhere-contains") return `text ∋ ${f.text}`;
  return `${f.field} = ${f.values[0].v}`;
}

function elRect(el: Element | null): DOMRect | null {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  return el.getBoundingClientRect();
}

function resolveAnchorRect(frameId: string): DOMRect | null {
  const id = CSS.escape(frameId);
  return (
    elRect(
      document.querySelector(
        `[data-view-toolbar][data-frame-id="${id}"] [data-view-settings-button="true"]`,
      ),
    ) ??
    elRect(document.querySelector(`[data-view-toolbar][data-frame-id="${id}"]`)) ??
    elRect(document.querySelector(`[data-view-toolbar-gear][data-frame-id="${id}"]`)) ??
    elRect(document.querySelector(`[data-zoomed-root-header][data-frame-id="${id}"]`)) ??
    elRect(document.querySelector(`[data-node-block][data-node-id="${id}"]`))
  );
}

/**
 * A frame's view settings, in one popover: the toolbar's gear and ⌘K
 * "Filter…" open it. Above the filters, every view's, are the settings the
 * frame's view declares (`ViewSettingsSections`). It portals to document.body so it is visible regardless
 * of nested-frame hover opacity.
 */
export function ViewSettingsPopoverHost() {
  const frameId = useViewSettingsFrame();
  const setOpenId = browserHost().setViewSettingsFrame;
  const generation = usePageGraph((s) => s.index?.generation ?? 0);
  const frame = useOutlineNode(frameId);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const fields = useMemo(() => {
    if (frameId === null) return [];
    return listFilterFieldOptions(frameId, outlineNodes(), browserHost().schema());
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- generation is the reactive invalidation key: the body reads the store imperatively via getState(), so generation drives recomputation
  }, [frameId, generation]);

  const config = getViewConfig(useFrameViewNode(frame)?.props);

  const [kind, setKind] = useState<FilterKind>("field-is");
  const [fieldId, setFieldId] = useState("");
  const [value, setValue] = useState("");

  useLayoutEffect(() => {
    if (frameId === null) {
      setAnchor(null);
      return;
    }
    const rect = resolveAnchorRect(frameId);
    if (!rect) {
      toast("select a frame first");
      setOpenId(null);
      setAnchor(null);
      return;
    }
    setAnchor(rect);
  }, [frameId, setOpenId, generation]);

  useEffect(() => {
    if (frameId === null || !anchor) return undefined;
    const onScroll = () => {
      const rect = resolveAnchorRect(frameId);
      if (rect) setAnchor(rect);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [frameId, anchor, setOpenId]);

  useEffect(() => {
    if (!fieldId && fields[0]) setFieldId(fields[0].id);
  }, [fields, fieldId]);

  // A filter button is a trigger: its click opens or closes its own frame's filter.
  useDismiss(
    frameId !== null && anchor !== null,
    { inside: [panelRef], trigger: '[data-view-settings-button="true"]' },
    () => setOpenId(null),
  );

  if (frameId === null || !anchor) return null;

  const add = () => {
    const text = value.trim();
    if (!text) return;
    if (kind === "anywhere-contains") {
      void browserHost().writes.addViewFilter(frameId, {
        kind: "anywhere-contains",
        text,
        exactCase: false,
      });
    } else {
      if (!fieldId) return;
      void browserHost().writes.addViewFilter(frameId, {
        kind: "field-is",
        field: fieldId,
        values: [{ t: "label", v: text }],
      });
    }
    setValue("");
  };

  const top = Math.min(anchor.bottom + 4, window.innerHeight - 12);
  const left = Math.max(8, Math.min(anchor.right - 320, window.innerWidth - 328));

  return createPortal(
    <PopoverShell
      panelRef={panelRef}
      title="View settings"
      aria-label="View settings"
      data-testid="view-settings-popover"
      className="fixed"
      style={{ top, left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div data-view-settings-popover="true" data-frame-id={frameId}>
        <ViewSettingsSections frameId={frameId} />
        <h3 className="px-1.5 pt-0.5 pb-0.5 text-meta text-foreground/40">Filters</h3>
        {config.filters.length === 0 ? (
          <p className="px-1.5 py-1 text-meta text-foreground/40">No filters</p>
        ) : (
          <ul className="mb-1 flex flex-col gap-0.5">
            {config.filters.map((f) => {
              const key = serializeViewFilter(f);
              return (
                <li
                  key={key}
                  className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-meta text-foreground/70 hover:bg-foreground/[0.04]"
                >
                  <span className="min-w-0 flex-1 truncate">{filterLabel(f)}</span>
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded-sm text-foreground/30 hover:text-foreground/60"
                    onClick={() => void browserHost().writes.removeViewFilter(frameId, f)}
                    aria-label="Remove filter"
                  >
                    <XIcon size={11} weight="bold" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <PrefFieldRow icon={FunnelIcon} label="kind">
          <EnumSelect
            className={POPOVER_VALUE_CLASS}
            value={kind}
            options={FILTER_KIND_OPTIONS}
            onChange={setKind}
          />
        </PrefFieldRow>

        {kind === "field-is" && (
          <PrefFieldRow icon={FunnelIcon} label="field">
            <select
              className={POPOVER_VALUE_CLASS}
              value={fieldId}
              onChange={(e) => setFieldId(e.target.value)}
            >
              {fields.length === 0 ? (
                <option value="">No fields on rows</option>
              ) : (
                fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.text}
                  </option>
                ))
              )}
            </select>
          </PrefFieldRow>
        )}

        <PrefFieldRow icon={TextTIcon} label={kind === "anywhere-contains" ? "text" : "value"}>
          <input
            className={POPOVER_VALUE_CLASS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={kind === "anywhere-contains" ? "substring" : "value"}
          />
        </PrefFieldRow>

        <button
          type="button"
          className="mt-1 flex w-full items-center justify-center gap-1 rounded-md bg-foreground/[0.04] px-2 py-1 text-label font-medium text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/80"
          onClick={add}
        >
          <PlusIcon size={12} weight="bold" />
          Add filter
        </button>
      </div>
    </PopoverShell>,
    document.body,
  );
}
