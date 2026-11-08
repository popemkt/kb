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
 * title and caption, a control in its heading, a lede under the heading
 * that shows folded or open, its rows, and what it draws after them while
 * every row shows. The filter keeps a section whose title matches whole,
 * and otherwise only the rows that match.
 */
export interface Section {
  readonly id: string;
  readonly title: string;
  /** Stable address independent of whether the section body is mounted. */
  readonly anchor?: string;
  readonly caption?: ReactNode;
  readonly aside?: ReactNode;
  readonly lede?: ReactNode;
  readonly testId?: string;
  readonly grid?: boolean;
  readonly rows: readonly Row[];
  readonly after?: ReactNode;
}

/**
 * Sections drawn together under one heading (the Extensions part's
 * Installed and Built-in): its id (what its fold is remembered by, when it
 * folds), its title and caption, its sections, and what it says when it
 * has none. A part with one untitled group draws its sections bare.
 * `cards` draws each section as a card rather than a rule-separated row.
 */
export interface SectionGroup {
  readonly id: string;
  readonly title?: string;
  readonly caption?: ReactNode;
  readonly cards?: boolean;
  readonly sections: readonly Section[];
  readonly empty?: ReactNode;
}

/** A part's groups: each titled one folds like a section, opening by default. */
export function Groups({ groups }: { readonly groups: readonly SectionGroup[] }) {
  return groups.map((group) => {
    const body =
      group.sections.length === 0 ? (
        (group.empty ?? null)
      ) : group.cards === true ? (
        <div className="space-y-2">
          {group.sections.map((section) => (
            <div
              key={section.id}
              className="rounded-md border border-border bg-card px-3 text-card-foreground"
            >
              <Fold section={section} rows={section.rows} whole />
            </div>
          ))}
        </div>
      ) : (
        group.sections.map((section) => (
          <Fold key={section.id} section={section} rows={section.rows} whole />
        ))
      );
    return group.title === undefined ? (
      <div key={group.id}>{body}</div>
    ) : (
      <Disclosure
        key={group.id}
        id={`group:${group.id}`}
        title={group.title}
        caption={group.caption}
        level="group"
      >
        {body}
      </Disclosure>
    );
  });
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
      anchor={section.anchor}
      title={section.title}
      caption={section.caption}
      aside={section.aside}
      lede={section.lede}
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

/**
 * A fold: a group of sections, a section of a part, or one inside a
 * section, opening as `opensBy` says until it is toggled. Its lede shows
 * under its heading whether it is open or not.
 */
export function Disclosure({
  id,
  anchor,
  title,
  caption,
  aside,
  lede,
  testId,
  forced = false,
  level,
  opensBy = true,
  children,
}: {
  readonly id: string;
  readonly anchor?: string;
  readonly title: string;
  readonly caption?: ReactNode;
  readonly aside?: ReactNode;
  readonly lede?: ReactNode;
  readonly testId?: string;
  readonly forced?: boolean;
  readonly level: "group" | "section" | "inner";
  readonly opensBy?: boolean;
  readonly children: ReactNode;
}) {
  const remembered = usePrefsStore((s) => s.settingsFolds[id]);
  const setFold = usePrefsStore((s) => s.setSettingsFold);
  const open = forced || (remembered ?? opensBy);
  const body = useId();
  const Heading = HEADINGS[level];
  return (
    <section
      id={anchor}
      aria-label={title}
      data-settings-section={id}
      data-open={open}
      data-testid={testId}
      className={SECTION_CLASS[level]}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 py-1">
        <Heading className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={body}
            data-settings-fold={id}
            className={`flex items-center gap-1.5 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${TOGGLE_CLASS[level]}`}
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
            <span className="flex items-center gap-2 text-caption text-faint-foreground">
              {caption}
            </span>
          )}
        </Heading>
        <span className="flex-1" />
        {aside}
      </div>
      {lede === undefined ? null : <div className="pb-2 pl-4">{lede}</div>}
      {open ? (
        <div id={body} className={BODY_CLASS[level]}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

const HEADINGS = { group: "h3", section: "h3", inner: "h4" } as const;
const SECTION_CLASS = {
  group: "mt-4",
  section: "border-t border-border first-of-type:border-t-0",
  inner: "mt-1",
} as const;
const TOGGLE_CLASS = {
  group: "kb-label text-meta text-muted-foreground hover:text-foreground",
  section: "text-ui font-medium text-foreground",
  inner: "text-meta text-muted-foreground hover:text-foreground",
} as const;
const BODY_CLASS = { group: "pt-1", section: "pb-3 pl-4", inner: "pb-1 pl-4" } as const;

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
