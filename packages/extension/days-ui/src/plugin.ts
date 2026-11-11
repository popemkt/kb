import { lazy } from "react";
import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { capturesToday, DAYS_IDS, daysExtension, daysPlugin, showsTouched } from "@kb/days";
import { refValuesOf } from "@kb/model";
import { definePlugin } from "@kb/plugin";
import {
  BrowserHostService,
  browserHost,
  CaptureTargetService,
  CommandPoint,
  DateTargetService,
  LandingService,
  NodeSectionPoint,
  SidebarSectionPoint,
  type NodeMap,
} from "@kb/ui-sdk";
import { goToTodayCommand } from "./command";
import { TodaySection } from "./section";
import { dayNode, todayNode } from "./today";

/** "Made or edited", in a chunk of its own, fetched the first time a period's page shows it. */
const TouchedSection = lazy(() =>
  import("./touched-section").then((m) => ({ default: m.TouchedSection })),
);

/**
 * "Made or edited" on each period's page (DESIGN-UI.md → Days): a section
 * below the node's outline (`NodeSectionPoint`) for `#day`, `#week` and
 * `#year`, and so for a tag of the person's that extends one. The family's
 * `made or edited` setting shows it; it is hidden until then.
 */
const PERIOD_SECTIONS = [
  { tag: DAYS_IDS.dayTag, period: "day" },
  { tag: DAYS_IDS.weekTag, period: "week" },
  { tag: DAYS_IDS.yearTag, period: "year" },
] as const;

const touchedSections = PERIOD_SECTIONS.map(({ tag, period }) => ({
  id: `touched-${period}`,
  value: {
    tags: [tag],
    order: 30,
    title: `Made or edited this ${period}`,
    shown: (nodes: NodeMap) => showsTouched(nodes.get(DAYS_IDS.family)),
    Component: TouchedSection,
  },
}));

/**
 * Where a page that loads at the root opens (DESIGN-UI.md → Days): today's
 * node unless the family's `open on` setting says home. The shell asks once
 * per page load, so switching the family on later never moves the page.
 */
async function landOnToday(): Promise<string | null> {
  const family = browserHost().nodes().get(DAYS_IDS.family);
  const [choice] = family === undefined ? [] : refValuesOf(family, DAYS_IDS.openOnField);
  return choice === DAYS_IDS.openOnHome ? null : todayNode();
}

/**
 * Where the page's own captures go (DESIGN-UI.md → Days): today's node, in
 * the page's local day, unless the family's `captures` setting says the
 * top level.
 */
function captureIntoToday(): Promise<string | null> {
  return capturesToday(browserHost().nodes().get(DAYS_IDS.family))
    ? todayNode()
    : Promise.resolve(null);
}

/**
 * The days family's page entry (DESIGN-UI.md → Days). It loads the family's
 * plugin as a child, so `ext.days.today` and the one-node-per-key guard are
 * the page kernel's too, and adds "made or edited" on each period's page,
 * the Today row, ⌘K "Go to today", and its replacements of three roles: the
 * capture target and the landing answer today's node, and the date target a
 * date's own day.
 */
export const daysUiPlugin = definePlugin({
  name: daysExtension.name,
  tags: familyTags(daysExtension, "ui"),
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(daysPlugin()),
        ...touchedSections.map((section) => ctx.contribute(NodeSectionPoint, section)),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 5, Component: TodaySection },
        }),
        ctx.contribute(CommandPoint, { id: goToTodayCommand.id, value: goToTodayCommand }),
        ctx.provide(CaptureTargetService, captureIntoToday),
        ctx.provide(LandingService, landOnToday),
        ctx.provide(DateTargetService, dayNode),
      ],
      { discard: true },
    ),
});
