/**
 * A node page's References (DESIGN-UI.md → References): the nodes that
 * reference it, then the ones that name it in plain text, drawn as the
 * page's outline is drawn and disclosed a step at a time. Closed, it is one
 * line that says how many; open, the references come place by place, a few
 * places and a few rows of each, and the unlinked mentions wait behind their
 * own line. Nothing opens everything at once.
 */
import { type ReactNode, useState } from "react";
import {
  childInstanceKey,
  NodeLinkRow,
  OutlineLine,
  projectedRowKey,
  rowTitle,
  schemaOf,
  shownNode,
  useAnswered,
  useGraphRead,
  useLastSettled,
  usePageGraph,
  usePane,
} from "@kb/ui-sdk";
import { backlinkRows, type BacklinkRow } from "./backlinks";
import { NodeBlock } from "./node-block";
import { groupByPlace, type ReferenceGroup } from "./reference-groups";
import { RowBreadcrumbs } from "./row-breadcrumbs";
import { SectionHeading } from "./section-heading";
import { MentionRow } from "./unlinked-mentions";
import { unlinkedMentionRows, type UnlinkedMentionRow } from "./unlinked-mentions-model";

/** Places shown when the section opens, and rows shown of each place. */
const PLACES_SHOWN = 5;
const ROWS_SHOWN = 3;
/** How many more one "Show more" reveals. */
const MORE = 10;

/** What the closed heading says: the references, then the unlinked mentions. */
function summary(linked: number, unlinked: number): string {
  const parts = linked > 0 ? [String(linked)] : [];
  if (unlinked > 0) parts.push(`${unlinked} unlinked`);
  return parts.join(" · ");
}

export function ReferencesSection({ nodeId }: { nodeId: string }) {
  const schema = usePageGraph(schemaOf);
  const index = usePageGraph((s) => s.index);
  const { value: backlinks } = useAnswered(
    (run) => backlinkRows(run, schema, index, nodeId),
    [nodeId, schema, index],
  );
  const mentionAnswer = useAnswered(
    (run) => unlinkedMentionRows(run, schema, nodeId),
    [nodeId, schema],
  );
  const mentions = useLastSettled(mentionAnswer, nodeId) ?? [];
  const [open, setOpen] = useState(false);
  const [mentionsOpen, setMentionsOpen] = useState(false);

  const pane = usePane();
  // The same referrer can also be a result in this page or visible in another pane.
  const parentKey = projectedRowKey(`references:${pane}`, nodeId);
  if (backlinks.length + mentions.length === 0) return null;

  const linkable = (row: UnlinkedMentionRow) =>
    mentionAnswer.settled && index?.isVirtual(row.node.id) !== true;
  return (
    <section
      className="references-section"
      data-references-for={nodeId}
      data-open={open ? "true" : undefined}
    >
      <SectionHeading
        count={summary(backlinks.length, mentions.length)}
        disclosure={{ open, toggle: () => setOpen((was) => !was) }}
      >
        References
      </SectionHeading>
      {open && backlinks.length > 0 && (
        <PlaceList
          groups={groupByPlace(backlinks, (row) => row.id, schema)}
          renderRow={(row, depth) => (
            <ReferenceItem key={row.id} row={row} depth={depth} parentKey={parentKey} />
          )}
        />
      )}
      {open && mentions.length > 0 && (
        <div data-unlinked-mentions-for={nodeId}>
          <SectionHeading
            count={mentions.length}
            disclosure={{ open: mentionsOpen, toggle: () => setMentionsOpen((was) => !was) }}
          >
            Unlinked mentions
          </SectionHeading>
          {mentionsOpen && (
            <PlaceList
              groups={groupByPlace(mentions, (row) => row.node.id, schema)}
              renderRow={(row, depth) => (
                <MentionRow key={row.node.id} row={row} depth={depth} linkable={linkable(row)} />
              )}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** The path above a group's place, as one comparable string. */
const pathOf = (group: ReferenceGroup<unknown> | undefined) =>
  group?.crumbs.map((crumb) => crumb.id).join("/");

/** The groups, a few places at first, each place's rows drawn by `renderRow`. */
function PlaceList<Row>({
  groups,
  renderRow,
}: {
  readonly groups: readonly ReferenceGroup<Row>[];
  readonly renderRow: (row: Row, depth: number) => ReactNode;
}) {
  const [shown, setShown] = useState(PLACES_SHOWN);
  const hidden = groups.length - shown;
  return (
    <>
      {groups.slice(0, shown).map((group, at) => (
        <Place
          key={group.place ?? ""}
          group={group}
          // A path is drawn where it changes: places side by side under one
          // parent read as that parent's rows do, with no path between them.
          pathShown={at === 0 || pathOf(group) !== pathOf(groups[at - 1])}
          renderRow={renderRow}
        />
      ))}
      {hidden > 0 && (
        <ShowMore
          depth={0}
          hidden={hidden}
          noun="places"
          onMore={() => setShown((n) => n + MORE)}
        />
      )}
    </>
  );
}

/**
 * One place: its path, where it differs from the place before; its own
 * row, whose bullet folds it as an outline row's does; and a few of its
 * rows under it. Rows at the top level have no place to name, and stand at
 * its depth.
 */
function Place<Row>({
  group,
  pathShown,
  renderRow,
}: {
  readonly group: ReferenceGroup<Row>;
  readonly pathShown: boolean;
  readonly renderRow: (row: Row, depth: number) => ReactNode;
}) {
  const { outline, schema } = useGraphRead();
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState(ROWS_SHOWN);
  const { place, rows } = group;
  const placeNode = place === null ? undefined : (outline.get(place) ?? schema.get(place));
  const depth = placeNode === undefined ? 0 : 1;
  const hidden = rows.length - shown;
  return (
    <div data-reference-place={place ?? ""}>
      {placeNode !== undefined && (
        <>
          {pathShown && <RowBreadcrumbs crumbs={group.crumbs} />}
          <NodeLinkRow
            id={placeNode.id}
            text={rowTitle(placeNode, schema)}
            tags={shownNode(placeNode, schema).tags}
            fold={{ open, toggle: () => setOpen((was) => !was) }}
          />
        </>
      )}
      {(open || placeNode === undefined) && (
        <>
          {rows.slice(0, shown).map((member) => renderRow(member, depth))}
          {hidden > 0 && (
            <ShowMore depth={depth} hidden={hidden} onMore={() => setShown((n) => n + MORE)} />
          )}
        </>
      )}
    </div>
  );
}

/** A line on the text column that reveals the next few of what a list holds back. */
function ShowMore({
  depth,
  hidden,
  noun,
  onMore,
}: {
  readonly depth: number;
  readonly hidden: number;
  readonly noun?: string;
  readonly onMore: () => void;
}) {
  const next = Math.min(hidden, MORE);
  const label = [`Show ${next} more`, noun].filter(Boolean).join(" ");
  return (
    <OutlineLine
      depth={depth}
      text={
        <button
          type="button"
          className="-ml-1 rounded-xs px-1 py-0.5 text-caption text-foreground/50 hover:bg-foreground/5 hover:text-foreground transition-colors duration-100 cursor-pointer"
          data-show-more="true"
          onClick={onMore}
        >
          {label}
          {hidden > next && <span className="text-foreground/35"> · {hidden} hidden</span>}
        </button>
      }
    />
  );
}

/**
 * A referrer: how it relates to the node, then its row, whose bullet opens
 * the shown node's children visible in the outline in place, as ordinary
 * rows.
 */
function ReferenceItem({
  row,
  depth,
  parentKey,
}: {
  row: BacklinkRow;
  depth: number;
  parentKey: string;
}) {
  const { outline, schema } = useGraphRead();
  const [expanded, setExpanded] = useState(false);
  const referrer = outline.get(row.id) ?? schema.get(row.id);
  const children =
    referrer === undefined
      ? []
      : shownNode(referrer, schema).children.filter((id) => outline.has(id));
  const instanceKey = childInstanceKey(parentKey, row.id);
  return (
    <div data-backlink-id={row.id}>
      <NodeLinkRow
        id={row.id}
        text={row.text}
        tags={row.tags}
        depth={depth}
        fold={
          children.length > 0
            ? { open: expanded, toggle: () => setExpanded((was) => !was) }
            : undefined
        }
        leading={row.relations.map((relation) => (
          <span
            key={relation.field}
            className="shrink-0 rounded-xs bg-foreground/[0.05] px-1.5 py-0.5 text-caption text-foreground/50"
            data-backlink-relation={relation.field}
          >
            {relation.label}
          </span>
        ))}
      />
      {expanded &&
        children.map((id) => (
          <NodeBlock
            key={id}
            nodeId={id}
            depth={depth + 1}
            instanceKey={childInstanceKey(instanceKey, id)}
          />
        ))}
    </div>
  );
}
