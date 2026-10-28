/**
 * What a Settings part is drawn from (DESIGN-UI.md → Settings): a section,
 * its rows, the fold every section is, and a setting's row, drawn with the
 * page's field editor.
 */
import type { NodeId } from "@kb/model";
import { type GraphRead, type PropValue, useFieldEditor } from "@kb/ui-sdk";
import { CaretRightIcon } from "@phosphor-icons/react";
import { createElement, useId, type ReactNode } from "react";
import { usePrefsStore } from "@/stores/prefs.store";

const NONE: PropValue[] = [];

/** One row of a section: what the filter reads it by, and what it draws. */
export interface Row {
  readonly key: string;
  readonly words: string;
  readonly node: ReactNode;
}

/**
 * One section of a part: its id (what its fold is remembered by), its
 * title and caption, a control in its heading, its rows, and what it draws
 * after them while every row shows. The filter keeps a section whose title
 * matches whole, and otherwise only the rows that match.
 */
export interface Section {
  readonly id: string;
  readonly title: string;
  readonly caption?: ReactNode;
  readonly aside?: ReactNode;
  readonly testId?: string;
  readonly grid?: boolean;
  readonly rows: readonly Row[];
  readonly after?: ReactNode;
}

/**
 * A section that folds: its heading is a button (`aria-expanded`), so
 * Enter or Space toggles it, and whether it is open is remembered on this
 * device. `forced`, it is open whatever was remembered (a filter's match).
 */
export function Fold({
  section,
  rows,
  whole,
  forced = false,
}: {
  readonly section: Section;
  readonly rows: readonly Row[];
  readonly whole: boolean;
  readonly forced?: boolean;
}) {
  return (
    <Disclosure
      id={section.id}
      title={section.title}
      caption={section.caption}
      aside={section.aside}
      testId={section.testId}
      forced={forced}
      level="section"
    >
      {section.grid === true ? (
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">{rows.map(drawRow)}</div>
      ) : (
        rows.map(drawRow)
      )}
      {whole ? section.after : null}
    </Disclosure>
  );
}

const drawRow = (row: Row) => <div key={row.key}>{row.node}</div>;

/** A fold: a section of a part, or one inside a section, opening as `opensBy` says until it is toggled. */
export function Disclosure({
  id,
  title,
  caption,
  aside,
  testId,
  forced = false,
  level,
  opensBy = true,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly caption?: ReactNode;
  readonly aside?: ReactNode;
  readonly testId?: string;
  readonly forced?: boolean;
  readonly level: "section" | "inner";
  readonly opensBy?: boolean;
  readonly children: ReactNode;
}) {
  const remembered = usePrefsStore((s) => s.settingsFolds[id]);
  const setFold = usePrefsStore((s) => s.setSettingsFold);
  const open = forced || (remembered ?? opensBy);
  const body = useId();
  const Heading = level === "section" ? "h3" : "h4";
  return (
    <section
      aria-label={title}
      data-settings-section={id}
      data-open={open}
      data-testid={testId}
      className={level === "section" ? "border-t border-border first-of-type:border-t-0" : "mt-1"}
    >
      <div className="flex min-h-9 items-center gap-2">
        <Heading className="m-0 flex min-w-0 items-baseline gap-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={body}
            data-settings-fold={id}
            className={`flex items-center gap-1.5 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              level === "section"
                ? "text-ui font-medium text-foreground"
                : "text-meta text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setFold(id, !open)}
          >
            <CaretRightIcon
              size={11}
              aria-hidden
              className={`flex-none text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
            />
            {title}
          </button>
          {caption === undefined ? null : (
            <span className="text-caption text-faint-foreground">{caption}</span>
          )}
        </Heading>
        <span className="flex-1" />
        {aside}
      </div>
      {open ? (
        <div id={body} className={level === "section" ? "pb-3 pl-4" : "pb-1 pl-4"}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** One setting of `nodeId`, drawn with the page's field editor, and a note under it. */
export function SettingRow({
  graph,
  nodeId,
  field,
  label,
  note,
}: {
  readonly graph: GraphRead;
  readonly nodeId: NodeId;
  readonly field: NodeId;
  readonly label: string;
  readonly note?: ReactNode;
}) {
  const editor = createElement(useFieldEditor(), {
    nodeId,
    fieldId: field,
    label,
    values: graph.schema.get(nodeId)?.props[field] ?? NONE,
    context: graph,
    depth: -1,
  });
  return (
    <div data-setting={field} data-setting-of={nodeId}>
      {editor}
      {note}
    </div>
  );
}
