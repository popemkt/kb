/**
 * A pane's view switcher: what else the pane can show. The node the pane is
 * shown for, opened each way this page can open it (`pageOpeningsOf`); then every page a route opens with nothing chosen. Choosing one moves the pane; nothing is written.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDownIcon } from "@phosphor-icons/react";
import { Predicate } from "effect";
import {
  cn,
  matchRoute,
  nodePath,
  RoutePoint,
  useAnchoredPosition,
  useContributions,
  ViewPoint,
  useDismiss,
} from "@kb/ui-sdk";
import { pageOpeningsOf } from "@/lib/node-openings";
import { usePageCatalog } from "@/lib/view-catalog";
import { useGraphStore, useShownNodes } from "@/stores/graph.store";
import { shownZoomAt } from "./pane-title";

interface Choice {
  readonly path: string;
  readonly label: string;
}

interface Section {
  readonly title: string;
  readonly choices: readonly Choice[];
}

/** The node a page at `path` is shown for, when it is shown for one. */
function hostOf(params: unknown): string | null {
  if (!Predicate.isObject(params)) return null;
  for (const key of ["node", "root", "id"] as const) {
    const value = params[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

function useSections(path: string): readonly Section[] {
  const routes = useContributions(RoutePoint);
  const views = useContributions(ViewPoint);
  const catalog = usePageCatalog();
  const nodes = useShownNodes();
  const zoom = useGraphStore((s) => s.rootNodeId);
  const route = matchRoute(routes, path);
  const host = route === null ? null : (hostOf(route.params) ?? shownZoomAt(path, zoom) ?? null);
  const sections: Section[] = [];
  const hostNode = host === null ? undefined : nodes.get(host);
  if (host !== null && hostNode !== undefined) {
    sections.push({
      title: hostNode.text.trim() === "" ? "This node" : hostNode.text.trim(),
      choices: pageOpeningsOf(host, catalog, views, (id) => nodes.get(id)).map(
        ({ view, label }) => ({ path: nodePath(host, view), label }),
      ),
    });
  }
  const pages = routes.flatMap(({ value }) =>
    value.entry === undefined ? [] : [{ path: value.entry, label: value.view.label }],
  );
  if (pages.length > 0) sections.push({ title: "Pages", choices: pages });
  return sections;
}

/**
 * The switcher's button (the pane's title with a caret) and, while open, its
 * menu. `onChoose` moves the pane.
 */
export function PaneSwitcher({
  path,
  title,
  onChoose,
}: {
  readonly path: string;
  readonly title: string;
  readonly onChoose: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={cn(
          "flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-left",
          "outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-primary/50",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${title} — switch view`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(!open)}
      >
        <span className="truncate">{title}</span>
        <CaretDownIcon size={10} weight="bold" className="shrink-0 opacity-50" aria-hidden />
      </button>
      {open ? (
        <SwitcherMenu
          anchor={anchor}
          path={path}
          onClose={() => setOpen(false)}
          onChoose={(next) => {
            setOpen(false);
            onChoose(next);
          }}
        />
      ) : null}
    </>
  );
}

function SwitcherMenu({
  anchor,
  path,
  onClose,
  onChoose,
}: {
  readonly anchor: React.RefObject<HTMLButtonElement | null>;
  readonly path: string;
  readonly onClose: () => void;
  readonly onChoose: (path: string) => void;
}) {
  const sections = useSections(path);
  const panel = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(anchor, panel, true);
  // The anchor is its trigger: its click toggles the switcher.
  useDismiss(true, { inside: [panel], trigger: anchor }, onClose);
  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label="Show in this pane"
      className="kb-surface-enter z-50 w-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-ui text-popover-foreground shadow-overlay"
      style={style ?? { position: "fixed", visibility: "hidden" }}
    >
      {sections.map((section) => (
        <div key={section.title} className="py-0.5">
          <p className="truncate px-2 pb-0.5 pt-1 text-label kb-label text-foreground/35">
            {section.title}
          </p>
          {section.choices.map((choice) => (
            <button
              key={choice.path}
              type="button"
              role="menuitemradio"
              aria-checked={choice.path === path}
              className={cn(
                "flex w-full items-center rounded-sm px-2 py-1 text-left outline-none",
                "hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06]",
                choice.path === path ? "text-foreground" : "text-foreground/65",
              )}
              onClick={() => onChoose(choice.path)}
            >
              <span className="truncate">{choice.label}</span>
              {choice.path === path ? (
                <span
                  className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                  aria-hidden
                />
              ) : null}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
