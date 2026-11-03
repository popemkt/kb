import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { RoutinesCalendarView, routinesDeclarationPlugin, routinesExtension } from "@kb/routines";
import {
  BrowserHostService,
  provideRoute,
  provideView,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";
import { CALENDAR_PATH, matchCalendar } from "./routes";
import { CalendarSection, CalendarSurface } from "./surfaces";

/**
 * The routines calendar: the family's page entry. It loads the family's
 * shared plugin as a child, so the calendar's key reaches the page kernel's
 * catalog from the family as the server's does, and adds the page, its
 * route (`/calendar`) and its sidebar row. The family is hosted by `kb ui`
 * and off by default, so all of it exists only while the server reports it
 * on.
 */
export const routinesUiPlugin = definePlugin({
  name: routinesExtension.name,
  tags: familyTags(routinesExtension, "ui"),
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(routinesDeclarationPlugin()),
        ctx.contribute(
          ViewPoint,
          provideView(RoutinesCalendarView, {
            placements: ["page"],
            sample: {},
            Component: CalendarSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: RoutinesCalendarView,
            match: matchCalendar,
            entry: CALENDAR_PATH,
            frame: () => "full",
            pendingTitle: () => "Opening the calendar…",
          }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 36, Component: CalendarSection },
        }),
      ],
      { discard: true },
    ),
});
